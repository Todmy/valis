/**
 * Lifecycle timeline component — renders audit trail entries for a decision
 * as a vertical timeline with dots and connecting lines.
 *
 * Dark mode styling consistent with the decision detail page.
 */

'use client';

interface LifecycleEntry {
  id: string;
  action: string;
  author_name: string;
  member_role: string;
  reason: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  decision_stored: { label: 'Created', color: 'bg-green-500' },
  decision_deprecated: { label: 'Deprecated', color: 'bg-red-500' },
  decision_superseded: { label: 'Superseded', color: 'bg-gray-500' },
  decision_promoted: { label: 'Promoted', color: 'bg-blue-500' },
  decision_depends_added: { label: 'Dependency added', color: 'bg-indigo-500' },
  decision_pinned: { label: 'Pinned', color: 'bg-yellow-500' },
  decision_unpinned: { label: 'Unpinned', color: 'bg-gray-500' },
  decision_enriched: { label: 'Enriched', color: 'bg-purple-500' },
  decision_auto_deduped: { label: 'Auto-deduped', color: 'bg-orange-500' },
  pattern_synthesized: { label: 'Pattern synthesized', color: 'bg-teal-500' },
  contradiction_detected: { label: 'Contradiction detected', color: 'bg-red-400' },
  contradiction_resolved: { label: 'Contradiction resolved', color: 'bg-green-400' },
};

interface LifecycleTimelineProps {
  entries: LifecycleEntry[];
}

export function LifecycleTimeline({ entries }: LifecycleTimelineProps) {
  if (entries.length === 0) return null;

  return (
    <div className="relative">
      {entries.map((entry, idx) => {
        const isLast = idx === entries.length - 1;
        const actionInfo = ACTION_LABELS[entry.action] ?? {
          label: entry.action.replace(/_/g, ' '),
          color: 'bg-gray-500',
        };

        return (
          <div key={entry.id} className="relative flex gap-4 pb-6">
            {/* Vertical line + dot */}
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full ${actionInfo.color} ring-4 ring-gray-950 flex-shrink-0 z-10`} />
              {!isLast && (
                <div className="w-0.5 bg-gray-800 flex-1 min-h-[24px]" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 -mt-0.5 pb-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-200">{actionInfo.label}</span>
                <span className="text-xs text-gray-500">
                  by {entry.author_name}
                  {entry.member_role === 'admin' && (
                    <span className="ml-1 text-yellow-600">(admin)</span>
                  )}
                </span>
                <span className="text-xs text-gray-600">
                  {new Date(entry.created_at).toLocaleString()}
                </span>
              </div>

              {entry.reason && (
                <p className="text-sm text-gray-400 mt-1">{entry.reason}</p>
              )}

              {/* State change details */}
              {entry.new_state && Object.keys(entry.new_state).length > 0 && (
                <div className="mt-2 text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded p-2 font-mono">
                  {Object.entries(entry.new_state).map(([key, val]) => (
                    <div key={key}>
                      <span className="text-gray-600">{key}:</span>{' '}
                      <span className="text-gray-400">{String(val)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
