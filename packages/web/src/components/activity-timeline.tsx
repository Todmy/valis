/**
 * T033: Activity timeline component — shows recent audit entries.
 */

'use client';

import type { AuditEntry } from '@/lib/types';

interface ActivityTimelineProps {
  entries: AuditEntry[];
}

const ACTION_LABELS: Record<string, string> = {
  decision_stored: 'Decision stored',
  decision_deprecated: 'Decision deprecated',
  decision_superseded: 'Decision superseded',
  decision_promoted: 'Decision promoted',
  decision_depends_added: 'Dependency added',
  member_joined: 'Member joined',
  member_revoked: 'Member revoked',
  key_rotated: 'Key rotated',
  org_key_rotated: 'Org key rotated',
  contradiction_detected: 'Contradiction detected',
  contradiction_resolved: 'Contradiction resolved',
  decision_pinned: 'Decision pinned',
  decision_unpinned: 'Decision unpinned',
  decision_enriched: 'Decision enriched',
  decision_auto_deduped: 'Auto-deduped',
  pattern_synthesized: 'Pattern synthesized',
};

const ACTION_COLORS: Record<string, string> = {
  decision_stored: 'bg-green-400',
  decision_deprecated: 'bg-red-400',
  decision_superseded: 'bg-gray-400',
  decision_promoted: 'bg-blue-400',
  contradiction_detected: 'bg-yellow-400',
  pattern_synthesized: 'bg-teal-400',
  decision_pinned: 'bg-blue-500',
};

export function ActivityTimeline({ entries }: ActivityTimelineProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-gray-400">No recent activity.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3">
          <div
            className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${ACTION_COLORS[entry.action] ?? 'bg-gray-600'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-300">
              {ACTION_LABELS[entry.action] ?? entry.action}
            </div>
            {entry.reason && (
              <div className="text-xs text-gray-400 truncate">{entry.reason}</div>
            )}
          </div>
          <div className="text-xs text-gray-400 whitespace-nowrap">
            {formatRelativeTime(entry.created_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
