/**
 * T036: /decisions page — searchable decision list with status labels, pinned badges.
 *
 * Features:
 * - Paginated list (20/page) with load-more
 * - Filter by status, type, author, affects area
 * - Sort by created_at or confidence
 * - Expand for full detail
 * - Read-only (no mutation buttons)
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useDashboardAuth } from '@/app/app-shell';
import type { Decision, DecisionStatus, DecisionType } from '@/lib/types';
import { DecisionCard } from '@/components/decision-card';
import { SearchBar } from '@/components/search-bar';

const PAGE_SIZE = 20;

type SortField = 'created_at' | 'confidence';

export default function DecisionsPage() {
  const { supabase } = useDashboardAuth();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState<DecisionStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<DecisionType | ''>('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [affectsFilter, setAffectsFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');

  const fetchDecisions = useCallback(async (pageNum: number, append: boolean) => {
    if (!supabase) return;
    setLoading(true);

    let query = supabase
      .from('decisions')
      .select('*')
      .order(sortField, { ascending: false })
      .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

    if (statusFilter) query = query.eq('status', statusFilter);
    if (typeFilter) query = query.eq('type', typeFilter);
    if (authorFilter) query = query.ilike('author', `%${authorFilter}%`);
    if (affectsFilter) query = query.contains('affects', [affectsFilter]);
    if (searchQuery) query = query.or(`summary.ilike.%${searchQuery}%,detail.ilike.%${searchQuery}%`);

    const { data, error } = await query;
    if (error) {
      console.error('Failed to fetch decisions:', error);
      setLoading(false);
      return;
    }

    const results = (data ?? []) as Decision[];
    setDecisions(append ? (prev) => [...prev, ...results] : results);
    setHasMore(results.length === PAGE_SIZE);
    setLoading(false);
  }, [supabase, statusFilter, typeFilter, authorFilter, affectsFilter, searchQuery, sortField]);

  // Reset and fetch on filter change
  useEffect(() => {
    setPage(0);
    fetchDecisions(0, false);
  }, [fetchDecisions]);

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchDecisions(nextPage, true);
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-6">Decisions</h1>

      {/* Search */}
      <div className="mb-4">
        <SearchBar
          onSearch={(q) => setSearchQuery(q)}
          placeholder="Filter decisions by summary or detail..."
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DecisionStatus | '')}
          className="px-3 py-1.5 border border-gray-700 rounded-md text-sm bg-gray-800 text-gray-100"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="proposed">Proposed</option>
          <option value="deprecated">Deprecated</option>
          <option value="superseded">Superseded</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as DecisionType | '')}
          className="px-3 py-1.5 border border-gray-700 rounded-md text-sm bg-gray-800 text-gray-100"
        >
          <option value="">All types</option>
          <option value="decision">Decision</option>
          <option value="constraint">Constraint</option>
          <option value="pattern">Pattern</option>
          <option value="lesson">Lesson</option>
          <option value="pending">Pending</option>
        </select>

        <input
          type="text"
          placeholder="Author..."
          value={authorFilter}
          onChange={(e) => setAuthorFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-700 rounded-md text-sm bg-gray-800 text-gray-100 placeholder-gray-600 w-36"
        />

        <input
          type="text"
          placeholder="Affects area..."
          value={affectsFilter}
          onChange={(e) => setAffectsFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-700 rounded-md text-sm bg-gray-800 text-gray-100 placeholder-gray-600 w-36"
        />

        <select
          value={sortField}
          onChange={(e) => setSortField(e.target.value as SortField)}
          className="px-3 py-1.5 border border-gray-700 rounded-md text-sm bg-gray-800 text-gray-100"
        >
          <option value="created_at">Sort: Newest</option>
          <option value="confidence">Sort: Confidence</option>
        </select>
      </div>

      {/* Decision list */}
      <div className="space-y-3">
        {decisions.map((decision) => (
          <DecisionCard key={decision.id} decision={decision} />
        ))}
      </div>

      {/* Loading / empty / load more */}
      {loading && (
        <div className="text-center py-8 text-gray-400">Loading decisions...</div>
      )}

      {!loading && decisions.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          No decisions found matching your filters.
        </div>
      )}

      {!loading && hasMore && decisions.length > 0 && (
        <div className="text-center py-6">
          <button
            onClick={loadMore}
            className="px-4 py-2 text-sm text-brand-400 border border-brand-600 rounded-md hover:bg-brand-950 transition-colors"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
