/**
 * T037: /search page — search interface matching CLI search quality.
 *
 * Features:
 * - Search bar with type-ahead
 * - Results with composite score + signal breakdown when available
 * - Suppressed results hidden by default, toggle to show all
 * - Falls back to client-side text search if no RPC exists
 */

'use client';

import { useState, useCallback } from 'react';
import { useDashboardAuth } from '@/app/app-shell';
import type { Decision } from '@/lib/types';
import { DecisionCard } from '@/components/decision-card';
import { SearchBar } from '@/components/search-bar';

interface SearchResultItem extends Decision {
  /** Composite score from reranker, if available. */
  composite_score?: number;
  /** Individual signal values, if available. */
  signals?: {
    semantic_score: number;
    bm25_score: number;
    recency_decay: number;
    importance: number;
    graph_connectivity: number;
  };
  /** Whether this result was suppressed. */
  suppressed?: boolean;
}

export default function SearchPage() {
  const { supabase } = useDashboardAuth();
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [suppressedCount, setSuppressedCount] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');

  const doSearch = useCallback(async (query: string) => {
    if (!supabase || !query) return;
    setLoading(true);
    setSearched(true);

    // Try RPC first (matches CLI search pipeline including reranking)
    const rpcResult = await supabase.rpc('search_decisions', {
      p_query: query,
      p_type: typeFilter || null,
      p_limit: 50,
    });

    if (rpcResult.data && !rpcResult.error) {
      const data = rpcResult.data as SearchResultItem[];
      const suppressed = data.filter((d) => d.suppressed);
      setSuppressedCount(suppressed.length);
      setResults(data);
      setLoading(false);
      return;
    }

    // Fallback: client-side text search via Supabase
    let query_builder = supabase
      .from('decisions')
      .select('*')
      .or(`summary.ilike.%${query}%,detail.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (typeFilter) {
      query_builder = query_builder.eq('type', typeFilter);
    }

    const { data, error } = await query_builder;
    if (error) {
      console.error('Search failed:', error);
      setResults([]);
    } else {
      setResults((data ?? []) as SearchResultItem[]);
      setSuppressedCount(0);
    }
    setLoading(false);
  }, [supabase, typeFilter]);

  const visibleResults = showSuppressed
    ? results
    : results.filter((r) => !r.suppressed);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-6">Search</h1>

      <div className="mb-4">
        <SearchBar onSearch={doSearch} placeholder="Search your team's decision brain..." />
      </div>

      {/* Filters & controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-700 rounded-md text-sm bg-gray-800 text-gray-100"
        >
          <option value="">All types</option>
          <option value="decision">Decision</option>
          <option value="constraint">Constraint</option>
          <option value="pattern">Pattern</option>
          <option value="lesson">Lesson</option>
          <option value="pending">Pending</option>
        </select>

        {suppressedCount > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={showSuppressed}
              onChange={(e) => setShowSuppressed(e.target.checked)}
              className="rounded border-gray-700"
            />
            Show {suppressedCount} suppressed results
          </label>
        )}
      </div>

      {/* Results */}
      {loading && (
        <div className="text-center py-8 text-gray-400">Searching...</div>
      )}

      {!loading && searched && visibleResults.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          No results found. Try a different query.
        </div>
      )}

      <div className="space-y-3">
        {visibleResults.map((result) => (
          <div key={result.id} className="relative">
            {result.suppressed && (
              <div className="absolute top-2 right-2 text-xs text-gray-400 bg-gray-950 px-1.5 py-0.5 rounded">
                suppressed
              </div>
            )}

            {/* Signal breakdown when available */}
            {result.composite_score != null && (
              <div className="mb-1 flex items-center gap-2 text-xs text-gray-400">
                <span className="font-medium">Score: {result.composite_score.toFixed(3)}</span>
                {result.signals && (
                  <>
                    <span>sem:{result.signals.semantic_score.toFixed(2)}</span>
                    <span>bm25:{result.signals.bm25_score.toFixed(2)}</span>
                    <span>rec:{result.signals.recency_decay.toFixed(2)}</span>
                    <span>imp:{result.signals.importance.toFixed(2)}</span>
                    <span>graph:{result.signals.graph_connectivity.toFixed(2)}</span>
                  </>
                )}
              </div>
            )}

            <DecisionCard decision={result} />
          </div>
        ))}
      </div>
    </div>
  );
}
