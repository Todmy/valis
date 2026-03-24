/**
 * T038: /dashboard page — lifecycle stats, team activity, decision counts.
 *
 * Widgets:
 * - Total decisions with breakdown by type/status
 * - Team activity timeline (recent audit entries)
 * - Usage quota bars
 * - Proposed decisions count (links to /proposed)
 * - Open contradictions count (links to /contradictions)
 */

'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import type { AuditEntry, DecisionStatus, DecisionType } from '@/lib/types';
import { StatsGrid } from '@/components/stats-grid';
import { ActivityTimeline } from '@/components/activity-timeline';

interface DecisionCounts {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

export default function DashboardPage() {
  const { supabase, session } = useAuth();
  const [counts, setCounts] = useState<DecisionCounts | null>(null);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;

    async function fetchDashboard() {
      setLoading(true);

      // Fetch all decisions (type + status only for counting)
      const [decisionsRes, auditRes] = await Promise.all([
        supabase!.from('decisions').select('type, status'),
        supabase!.from('audit_entries').select('*').order('created_at', { ascending: false }).limit(50),
      ]);

      // Count decisions
      const rows = (decisionsRes.data ?? []) as Array<{ type: DecisionType; status: DecisionStatus }>;
      const byType: Record<string, number> = {};
      const byStatus: Record<string, number> = {};

      for (const row of rows) {
        byType[row.type] = (byType[row.type] ?? 0) + 1;
        byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      }

      setCounts({
        total: rows.length,
        byType,
        byStatus,
      });

      setActivity((auditRes.data ?? []) as AuditEntry[]);
      setLoading(false);
    }

    fetchDashboard();
  }, [supabase]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading dashboard...</p>
      </div>
    );
  }

  const proposedCount = counts?.byStatus['proposed'] ?? 0;
  const activeCount = counts?.byStatus['active'] ?? 0;
  const deprecatedCount = counts?.byStatus['deprecated'] ?? 0;
  const supersededCount = counts?.byStatus['superseded'] ?? 0;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        {session && (
          <p className="text-gray-500 text-sm mt-1">{session.orgName}</p>
        )}
      </div>

      {/* Top-level stats */}
      <StatsGrid
        items={[
          { label: 'Total Decisions', value: counts?.total ?? 0 },
          { label: 'Active', value: activeCount, variant: 'success' },
          { label: 'Proposed', value: proposedCount, href: '/proposed', variant: proposedCount > 0 ? 'warning' : 'default' },
          { label: 'Contradictions', value: counts?.byStatus['open'] ?? 0, href: '/contradictions', variant: 'info' },
        ]}
      />

      {/* Breakdown by type */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">By Type</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(['decision', 'constraint', 'pattern', 'lesson', 'pending'] as const).map((type) => (
            <div key={type} className="bg-white border rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{counts?.byType[type] ?? 0}</div>
              <div className="text-xs text-gray-500 capitalize">{type}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Breakdown by status */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">By Status</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            { key: 'active', color: 'bg-green-500' },
            { key: 'proposed', color: 'bg-yellow-500' },
            { key: 'deprecated', color: 'bg-red-400' },
            { key: 'superseded', color: 'bg-gray-400' },
          ] as const).map(({ key, color }) => {
            const count = counts?.byStatus[key] ?? 0;
            const pct = counts?.total ? Math.round((count / counts.total) * 100) : 0;
            return (
              <div key={key} className="bg-white border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500 capitalize">{key}</span>
                  <span className="text-sm font-bold text-gray-900">{count}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${color}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Activity timeline */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Recent Activity</h2>
        <div className="bg-white border rounded-lg p-4 max-h-96 overflow-y-auto">
          <ActivityTimeline entries={activity} />
        </div>
      </section>
    </div>
  );
}
