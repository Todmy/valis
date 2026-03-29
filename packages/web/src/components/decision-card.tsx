/**
 * T033: Decision card component — displays a single decision with metadata.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Decision } from '@/lib/types';
import { StatusBadge } from './status-badge';
import { PinBadge } from './pin-badge';

interface DecisionCardProps {
  decision: Decision;
}

export function DecisionCard({ decision }: DecisionCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-800 rounded-lg p-4 hover:shadow-sm transition-shadow bg-gray-900">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={decision.type} />
          <StatusBadge status={decision.status} />
          <PinBadge pinned={decision.pinned} />
          {decision.enriched_by && (
            <span className="text-xs text-purple-400 bg-purple-950 px-1.5 py-0.5 rounded">
              enriched:{decision.enriched_by}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {new Date(decision.created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Summary */}
      {decision.summary && (
        <h3 className="font-medium text-gray-100 mb-1">
          <Link
            href={`/decisions/${decision.id}`}
            className="hover:underline hover:text-white transition-colors"
          >
            {decision.summary}
          </Link>
        </h3>
      )}

      {/* Detail preview or full */}
      <p className="text-sm text-gray-400 mb-2">
        {expanded ? decision.detail : truncate(decision.detail, 200)}
      </p>

      {decision.detail.length > 200 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-brand-600 hover:text-brand-700 mb-2"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {/* Metadata */}
      <div className="flex flex-wrap gap-2 text-xs text-gray-400">
        <span>by {decision.author}</span>
        {decision.confidence != null && (
          <span>confidence: {(decision.confidence * 100).toFixed(0)}%</span>
        )}
        {decision.source && (
          <span className="text-gray-400">{decision.source}</span>
        )}
      </div>

      {/* Affects tags */}
      {decision.affects && decision.affects.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {decision.affects.map((area) => (
            <span
              key={area}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-950 text-gray-300"
            >
              {area}
            </span>
          ))}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-400 space-y-1">
          <div>ID: {decision.id}</div>
          {decision.depends_on && decision.depends_on.length > 0 && (
            <div>Depends on: {decision.depends_on.join(', ')}</div>
          )}
          {decision.replaces && <div>Replaces: {decision.replaces}</div>}
          {decision.status_changed_by && (
            <div>
              Status changed by {decision.status_changed_by}
              {decision.status_changed_at && ` at ${new Date(decision.status_changed_at).toLocaleString()}`}
              {decision.status_reason && ` — ${decision.status_reason}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    decision: 'bg-indigo-950 text-indigo-300',
    constraint: 'bg-orange-950 text-orange-300',
    pattern: 'bg-teal-950 text-teal-300',
    lesson: 'bg-pink-950 text-pink-300',
    pending: 'bg-gray-950 text-gray-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[type] ?? styles.pending}`}>
      {type}
    </span>
  );
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}
