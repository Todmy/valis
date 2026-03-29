/**
 * T033: Status badge component — active/proposed/deprecated/superseded labels.
 */

'use client';

import type { DecisionStatus } from '@/lib/types';

const STATUS_STYLES: Record<DecisionStatus, string> = {
  active: 'bg-green-950 text-green-300',
  proposed: 'bg-yellow-950 text-yellow-300',
  deprecated: 'bg-red-950 text-red-400',
  superseded: 'bg-gray-950 text-gray-400',
};

export function StatusBadge({ status }: { status: DecisionStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
