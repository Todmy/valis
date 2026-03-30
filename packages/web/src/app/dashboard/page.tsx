/**
 * T038: /dashboard page — lifecycle stats, team activity, decision counts,
 * active members, usage quotas, and project list.
 *
 * Widgets:
 * - Total decisions with breakdown by type/status
 * - Active members list
 * - Usage quota bars (decisions + searches)
 * - Projects list
 * - Team activity timeline (recent audit entries)
 * - Proposed decisions count (links to /proposed)
 * - Open contradictions count (links to /contradictions)
 */

'use client';

import { useEffect, useState } from 'react';
import { useDashboardAuth } from '@/app/app-shell';
import type { AuditEntry, DecisionStatus, DecisionType, MemberRole } from '@/lib/types';
import { StatsGrid } from '@/components/stats-grid';
import { ActivityTimeline } from '@/components/activity-timeline';
import { UsageBar } from '@/components/usage-bars';

interface DecisionCounts {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

interface ActiveMember {
  id: string;
  author_name: string;
  role: MemberRole;
}

interface UsageCounts {
  store_count: number;
  search_count: number;
}

interface ProjectInfo {
  project_id: string;
  projects: { id: string; name: string } | null;
}

const FREE_TIER_LIMIT = 100;

export default function DashboardPage() {
  const { supabase, userEmail } = useDashboardAuth();
  const [counts, setCounts] = useState<DecisionCounts | null>(null);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [members, setMembers] = useState<ActiveMember[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [usage, setUsage] = useState<UsageCounts | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;

    async function fetchDashboard() {
      setLoading(true);

      const [decisionsRes, auditRes, membersRes, usageRes, projectsRes] = await Promise.all([
        supabase!.from('decisions').select('type, status'),
        supabase!.from('audit_entries').select('*').order('created_at', { ascending: false }).limit(50),
        supabase!.from('members').select('id, author_name, role', { count: 'exact' }).is('revoked_at', null),
        supabase!.from('rate_limits').select('store_count, search_count').single(),
        supabase!.from('project_members').select('project_id, projects(name, id)'),
      ]);

      // Count decisions
      const rows = (decisionsRes.data ?? []) as Array<{ type: DecisionType; status: DecisionStatus }>;
      const byType: Record<string, number> = {};
      const byStatus: Record<string, number> = {};

      for (const row of rows) {
        byType[row.type] = (byType[row.type] ?? 0) + 1;
        byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      }

      setCounts({ total: rows.length, byType, byStatus });
      setActivity((auditRes.data ?? []) as AuditEntry[]);

      // Members
      setMembers((membersRes.data ?? []) as ActiveMember[]);
      setMemberCount(membersRes.count ?? 0);

      // Usage
      if (usageRes.data) {
        setUsage(usageRes.data as UsageCounts);
      }

      // Projects
      setProjects((projectsRes.data ?? []).map((d: Record<string, unknown>) => ({
        project_id: d.project_id as string,
        projects: Array.isArray(d.projects) ? d.projects[0] ?? null : d.projects as { id: string; name: string } | null,
      })));

      setLoading(false);
    }

    fetchDashboard();
  }, [supabase]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400">Loading dashboard...</p>
      </div>
    );
  }

  const proposedCount = counts?.byStatus['proposed'] ?? 0;
  const activeCount = counts?.byStatus['active'] ?? 0;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Dashboard</h1>
        {userEmail && (
          <p className="text-gray-400 text-sm mt-1">{userEmail}</p>
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

      {/* Active Members + Usage Quotas side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Active Members */}
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-100">Active Members</h2>
            <span className="text-sm text-gray-400">{memberCount} total</span>
          </div>
          {members.length === 0 ? (
            <p className="text-gray-500 text-sm">No active members.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-200">{m.author_name}</span>
                  <span className="text-xs text-gray-500 capitalize">{m.role}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Usage Quotas */}
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-gray-100 mb-3">Usage Quotas</h2>
          <div className="space-y-4">
            <UsageBar
              label="Decisions"
              current={usage?.store_count ?? 0}
              max={FREE_TIER_LIMIT}
              color="bg-blue-500"
            />
            <UsageBar
              label="Searches"
              current={usage?.search_count ?? 0}
              max={FREE_TIER_LIMIT}
              color="bg-violet-500"
            />
          </div>
        </section>
      </div>

      {/* Projects */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-3">Projects</h2>
        {projects.length === 0 ? (
          <p className="text-gray-500 text-sm">No projects found.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {projects.map((p) => (
              <a
                key={p.project_id}
                href={`/projects/${p.project_id}`}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
              >
                <div className="text-sm font-medium text-gray-100">
                  {p.projects?.name ?? 'Unnamed Project'}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Breakdown by type */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-3">By Type</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(['decision', 'constraint', 'pattern', 'lesson', 'pending'] as const).map((type) => (
            <div key={type} className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-gray-100">{counts?.byType[type] ?? 0}</div>
              <div className="text-xs text-gray-500 capitalize">{type}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Breakdown by status */}
      <section>
        <h2 className="text-lg font-semibold text-gray-100 mb-3">By Status</h2>
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
              <div key={key} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400 capitalize">{key}</span>
                  <span className="text-sm font-bold text-gray-100">{count}</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2">
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
        <h2 className="text-lg font-semibold text-gray-100 mb-3">Recent Activity</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 max-h-96 overflow-y-auto">
          <ActivityTimeline entries={activity} />
        </div>
      </section>
    </div>
  );
}
