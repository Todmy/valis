/**
 * Decision detail page — full decision view with lifecycle history,
 * dependencies, supersession chain, and related contradictions.
 *
 * Dark mode palette matching the nav sidebar.
 */

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import type { Decision, Contradiction } from '@/lib/types';
import { StatusBadge } from '@/components/status-badge';
import { PinBadge } from '@/components/pin-badge';
import { LifecycleTimeline } from '@/components/lifecycle-timeline';

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

const TYPE_STYLES: Record<string, string> = {
  decision: 'bg-indigo-900/50 text-indigo-300 border border-indigo-700',
  constraint: 'bg-orange-900/50 text-orange-300 border border-orange-700',
  pattern: 'bg-teal-900/50 text-teal-300 border border-teal-700',
  lesson: 'bg-pink-900/50 text-pink-300 border border-pink-700',
  pending: 'bg-gray-800 text-gray-400 border border-gray-700',
};

export default function DecisionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { supabase } = useAuth();

  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Related data
  const [lifecycle, setLifecycle] = useState<LifecycleEntry[]>([]);
  const [dependencies, setDependencies] = useState<Decision[]>([]);
  const [replacedDecision, setReplacedDecision] = useState<Decision | null>(null);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);

  // Fetch the decision
  useEffect(() => {
    if (!supabase || !id) return;

    async function fetchDecision() {
      setLoading(true);
      setError(null);

      const { data, error: err } = await supabase!
        .from('decisions')
        .select('*')
        .eq('id', id)
        .single();

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const d = data as Decision;
      setDecision(d);
      setLoading(false);

      // Fetch related data in parallel
      const promises: PromiseLike<void>[] = [];

      // Lifecycle history via RPC
      promises.push(
        supabase!
          .rpc('get_lifecycle_history', { p_decision_id: id })
          .then(({ data: entries }) => {
            if (entries) setLifecycle(entries as LifecycleEntry[]);
          }),
      );

      // Dependencies
      if (d.depends_on && d.depends_on.length > 0) {
        promises.push(
          supabase!
            .from('decisions')
            .select('*')
            .in('id', d.depends_on)
            .then(({ data: deps }) => {
              if (deps) setDependencies(deps as Decision[]);
            }),
        );
      }

      // Replaced decision
      if (d.replaces) {
        promises.push(
          supabase!
            .from('decisions')
            .select('*')
            .eq('id', d.replaces)
            .single()
            .then(({ data: replaced }) => {
              if (replaced) setReplacedDecision(replaced as Decision);
            }),
        );
      }

      // Related contradictions (this decision is either decision_a or decision_b)
      promises.push(
        supabase!
          .from('contradictions')
          .select('*, decision_a:decision_a_id(id, summary, status), decision_b:decision_b_id(id, summary, status)')
          .or(`decision_a_id.eq.${id},decision_b_id.eq.${id}`)
          .then(({ data: contras }) => {
            if (contras) setContradictions(contras as Contradiction[]);
          }),
      );

      await Promise.allSettled(promises);
    }

    fetchDecision();
  }, [supabase, id]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center py-16 text-gray-400">Loading decision...</div>
      </div>
    );
  }

  if (error || !decision) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center py-16">
          <p className="text-red-400 mb-4">{error ?? 'Decision not found'}</p>
          <Link href="/decisions" className="text-brand-400 hover:text-brand-300 text-sm">
            Back to decisions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back link */}
      <Link
        href="/decisions"
        className="inline-flex items-center text-sm text-gray-400 hover:text-gray-200 mb-6 transition-colors"
      >
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to decisions
      </Link>

      {/* Main card */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
        {/* Badges row */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium ${TYPE_STYLES[decision.type] ?? TYPE_STYLES.pending}`}>
            {decision.type}
          </span>
          <StatusBadge status={decision.status} />
          <PinBadge pinned={decision.pinned} />
          {decision.enriched_by && (
            <span className="text-xs text-purple-400 bg-purple-900/40 border border-purple-700 px-2 py-0.5 rounded">
              enriched: {decision.enriched_by}
            </span>
          )}
        </div>

        {/* Summary */}
        {decision.summary && (
          <h1 className="text-xl font-bold text-gray-100 mb-3">{decision.summary}</h1>
        )}

        {/* Detail */}
        <p className="text-gray-300 whitespace-pre-wrap leading-relaxed mb-6">{decision.detail}</p>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <MetaField label="Author" value={decision.author} />
          <MetaField label="Created" value={new Date(decision.created_at).toLocaleString()} />
          <MetaField label="Updated" value={new Date(decision.updated_at).toLocaleString()} />
          {decision.confidence != null && (
            <MetaField label="Confidence" value={`${(decision.confidence * 100).toFixed(0)}%`} />
          )}
          {decision.source && (
            <MetaField label="Source" value={decision.source} />
          )}
          {decision.session_id && (
            <MetaField label="Session" value={decision.session_id} mono />
          )}
          <MetaField label="ID" value={decision.id} mono />
        </div>

        {/* Status change info */}
        {decision.status_changed_by && (
          <div className="mt-4 pt-4 border-t border-gray-800 text-sm text-gray-400">
            Status changed by <span className="text-gray-300">{decision.status_changed_by}</span>
            {decision.status_changed_at && (
              <> at {new Date(decision.status_changed_at).toLocaleString()}</>
            )}
            {decision.status_reason && (
              <span className="block mt-1 text-gray-500 italic">{decision.status_reason}</span>
            )}
          </div>
        )}

        {/* Affects tags */}
        {decision.affects && decision.affects.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Affects</span>
            <div className="flex flex-wrap gap-1.5">
              {decision.affects.map((area) => (
                <span
                  key={area}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-gray-800 text-gray-300 border border-gray-700"
                >
                  {area}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Replaces */}
      {replacedDecision && (
        <Section title="Replaces">
          <LinkedDecisionCard decision={replacedDecision} label="Superseded" />
        </Section>
      )}

      {/* Dependencies */}
      {dependencies.length > 0 && (
        <Section title="Dependencies">
          <div className="space-y-2">
            {dependencies.map((dep) => (
              <LinkedDecisionCard key={dep.id} decision={dep} label="Depends on" />
            ))}
          </div>
        </Section>
      )}

      {/* Contradictions */}
      {contradictions.length > 0 && (
        <Section title="Related Contradictions">
          <div className="space-y-2">
            {contradictions.map((c) => {
              const other = c.decision_a_id === id ? c.decision_b : c.decision_a;
              return (
                <div
                  key={c.id}
                  className="bg-gray-900 border border-gray-800 rounded-lg p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      c.status === 'open'
                        ? 'bg-red-900/40 text-red-400 border border-red-700'
                        : 'bg-gray-800 text-gray-500 border border-gray-700'
                    }`}>
                      {c.status}
                    </span>
                    {c.similarity_score != null && (
                      <span className="text-xs text-gray-500">
                        similarity: {(c.similarity_score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  {other && (
                    <Link
                      href={`/decisions/${other.id}`}
                      className="text-sm text-gray-300 hover:text-gray-100 hover:underline transition-colors"
                    >
                      {other.summary ?? 'Untitled decision'}
                    </Link>
                  )}
                  {c.overlap_areas && c.overlap_areas.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {c.overlap_areas.map((area) => (
                        <span key={area} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded border border-gray-700">
                          {area}
                        </span>
                      ))}
                    </div>
                  )}
                  {c.detected_at && (
                    <div className="text-xs text-gray-500 mt-2">
                      Detected {new Date(c.detected_at).toLocaleString()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Lifecycle timeline */}
      {lifecycle.length > 0 && (
        <Section title="Lifecycle History">
          <LifecycleTimeline entries={lifecycle} />
        </Section>
      )}
    </div>
  );
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-xs text-gray-500 uppercase tracking-wider block mb-0.5">{label}</span>
      <span className={`text-gray-300 ${mono ? 'font-mono text-xs break-all' : 'text-sm'}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </div>
  );
}

function LinkedDecisionCard({ decision, label }: { decision: Decision; label: string }) {
  return (
    <Link
      href={`/decisions/${decision.id}`}
      className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-gray-500">{label}</span>
        <StatusBadge status={decision.status} />
      </div>
      <span className="text-sm text-gray-300 hover:text-gray-100">
        {decision.summary ?? decision.detail.slice(0, 100)}
      </span>
    </Link>
  );
}
