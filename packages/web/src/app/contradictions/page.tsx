/**
 * T039: /contradictions page — contradiction pairs with overlap areas.
 *
 * Features:
 * - List of open contradictions
 * - Side-by-side decision pairs
 * - Overlap areas highlighted
 * - Similarity score
 * - Read-only (no "Resolve" button)
 */

'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import type { Contradiction } from '@/lib/types';
import { ContradictionPair } from '@/components/contradiction-pair';

export default function ContradictionsPage() {
  const { supabase } = useAuth();
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;

    async function fetchContradictions() {
      setLoading(true);

      const { data, error } = await supabase!
        .from('contradictions')
        .select('*, decision_a:decisions!decision_a_id(*), decision_b:decisions!decision_b_id(*)')
        .eq('status', 'open')
        .order('detected_at', { ascending: false });

      if (error) {
        console.error('Failed to fetch contradictions:', error);
        setLoading(false);
        return;
      }

      setContradictions((data ?? []) as Contradiction[]);
      setLoading(false);
    }

    fetchContradictions();
  }, [supabase]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Contradictions</h1>
        <span className="text-sm text-gray-400">
          {contradictions.length} open contradiction{contradictions.length !== 1 ? 's' : ''}
        </span>
      </div>

      <p className="text-sm text-gray-400 mb-6">
        Contradictions are detected automatically when new decisions conflict with existing ones.
        Resolution happens through the CLI (<code className="text-xs bg-gray-950 px-1 rounded">teamind dismiss-contradiction</code> or by deprecating one decision).
      </p>

      {loading && (
        <div className="text-center py-8 text-gray-400">Loading contradictions...</div>
      )}

      {!loading && contradictions.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-400 text-4xl mb-3">&#10003;</div>
          <p className="text-gray-400 font-medium">No open contradictions</p>
          <p className="text-gray-400 text-sm mt-1">
            All detected contradictions have been resolved.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {contradictions.map((c) => (
          <ContradictionPair key={c.id} contradiction={c} />
        ))}
      </div>
    </div>
  );
}
