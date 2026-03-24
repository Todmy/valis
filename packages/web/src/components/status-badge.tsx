/**
 * T033: Status badge component — active/proposed/deprecated/superseded labels.
 */

'use client';

import type { DecisionStatus } from '@/lib/types';

const STATUS_STYLES: Record<DecisionStatus, string> = {
  active: 'bg-green-100 text-green-800',
  proposed: 'bg-yellow-100 text-yellow-800',
  deprecated: 'bg-red-100 text-red-700',
  superseded: 'bg-gray-100 text-gray-600',
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
