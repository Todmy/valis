/**
 * T040: /proposed page — proposed decisions queue.
 *
 * Features:
 * - List of proposed decisions awaiting review
 * - Summary, author, date, affects areas
 * - Count in nav badge
 * - Read-only (no "Approve"/"Reject" buttons)
 */

'use client';

import { useEffect, useState } from 'react';
import { useDashboardAuth } from '@/app/app-shell';
import type { Decision } from '@/lib/types';
import { DecisionCard } from '@/components/decision-card';

export default function ProposedPage() {
  const { supabase } = useDashboardAuth();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;

    async function fetchProposed() {
      setLoading(true);

      const { data, error } = await supabase!
        .from('decisions')
        .select('*')
        .eq('status', 'proposed')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to fetch proposed decisions:', error);
        setLoading(false);
        return;
      }

      setDecisions((data ?? []) as Decision[]);
      setLoading(false);
    }

    fetchProposed();
  }, [supabase]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Proposed Decisions</h1>
        <span className="text-sm text-gray-400">
          {decisions.length} awaiting review
        </span>
      </div>

      <p className="text-sm text-gray-400 mb-6">
        Proposed decisions are awaiting team review. Promotion or rejection happens through
        the CLI via <code className="text-xs bg-gray-950 px-1 rounded">teamind_lifecycle</code> with action &quot;promote&quot; or &quot;deprecate&quot;.
      </p>

      {loading && (
        <div className="text-center py-8 text-gray-400">Loading proposed decisions...</div>
      )}

      {!loading && decisions.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-400 text-4xl mb-3">&#10003;</div>
          <p className="text-gray-400 font-medium">No proposed decisions</p>
          <p className="text-gray-400 text-sm mt-1">
            All proposals have been reviewed.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {decisions.map((decision) => (
          <DecisionCard key={decision.id} decision={decision} />
        ))}
      </div>
    </div>
  );
}
