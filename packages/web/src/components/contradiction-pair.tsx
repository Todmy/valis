/**
 * T033: Contradiction pair component — side-by-side decision display.
 */

'use client';

import type { Contradiction } from '@/lib/types';
import { StatusBadge } from './status-badge';

interface ContradictionPairProps {
  contradiction: Contradiction;
}

export function ContradictionPair({ contradiction }: ContradictionPairProps) {
  const { decision_a, decision_b } = contradiction;

  return (
    <div className="border border-red-800 rounded-lg p-4 bg-red-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-red-400">Contradiction</span>
          {contradiction.similarity_score != null && (
            <span className="text-xs text-red-400">
              similarity: {(contradiction.similarity_score * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">
          {new Date(contradiction.detected_at).toLocaleDateString()}
        </span>
      </div>

      {/* Overlap areas */}
      {contradiction.overlap_areas.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          <span className="text-xs text-gray-400 mr-1">Overlap:</span>
          {contradiction.overlap_areas.map((area) => (
            <span
              key={area}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-950 text-red-400"
            >
              {area}
            </span>
          ))}
        </div>
      )}

      {/* Side-by-side decisions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DecisionSide label="Decision A" decision={decision_a} id={contradiction.decision_a_id} />
        <DecisionSide label="Decision B" decision={decision_b} id={contradiction.decision_b_id} />
      </div>
    </div>
  );
}

function DecisionSide({
  label,
  decision,
  id,
}: {
  label: string;
  decision?: { summary: string | null; detail: string; status: string; author: string; affects?: string[] } | null;
  id: string;
}) {
  if (!decision) {
    return (
      <div className="bg-gray-900 rounded-md p-3 border border-gray-800">
        <div className="text-xs text-gray-400 mb-1">{label}</div>
        <div className="text-sm text-gray-500">ID: {id}</div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-md p-3 border border-gray-800">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-gray-400">{label}</span>
        <StatusBadge status={decision.status as 'active' | 'proposed' | 'deprecated' | 'superseded'} />
      </div>
      {decision.summary && (
        <div className="text-sm font-medium text-gray-100 mb-1">{decision.summary}</div>
      )}
      <div className="text-xs text-gray-400 line-clamp-3">{decision.detail}</div>
      <div className="text-xs text-gray-400 mt-1">by {decision.author}</div>
    </div>
  );
}
