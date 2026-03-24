/**
 * Shared types for the web dashboard.
 * Mirrors the CLI types for Decision, AuditEntry, Contradiction, etc.
 * Re-defined here to avoid cross-package dependency at runtime.
 */

export type DecisionType = 'decision' | 'constraint' | 'pattern' | 'lesson' | 'pending';
export type DecisionStatus = 'active' | 'deprecated' | 'superseded' | 'proposed';
export type DecisionSource = 'mcp_store' | 'file_watcher' | 'stop_hook' | 'seed' | 'synthesis';
export type MemberRole = 'admin' | 'member';

export interface Decision {
  id: string;
  org_id: string;
  type: DecisionType;
  summary: string | null;
  detail: string;
  status: DecisionStatus;
  author: string;
  source: DecisionSource;
  project_id: string | null;
  session_id: string | null;
  content_hash: string;
  confidence: number | null;
  affects: string[];
  created_at: string;
  updated_at: string;
  replaces?: string | null;
  depends_on?: string[];
  status_changed_by?: string | null;
  status_changed_at?: string | null;
  status_reason?: string | null;
  pinned?: boolean;
  enriched_by?: 'llm' | 'manual' | null;
}

export type AuditAction =
  | 'decision_stored'
  | 'decision_deprecated'
  | 'decision_superseded'
  | 'decision_promoted'
  | 'decision_depends_added'
  | 'member_joined'
  | 'member_revoked'
  | 'key_rotated'
  | 'org_key_rotated'
  | 'contradiction_detected'
  | 'contradiction_resolved'
  | 'decision_pinned'
  | 'decision_unpinned'
  | 'decision_enriched'
  | 'decision_auto_deduped'
  | 'pattern_synthesized';

export interface AuditEntry {
  id: string;
  org_id: string;
  member_id: string;
  action: AuditAction;
  target_type: 'decision' | 'member' | 'org';
  target_id: string;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export type ContradictionStatus = 'open' | 'resolved';

export interface Contradiction {
  id: string;
  org_id: string;
  decision_a_id: string;
  decision_b_id: string;
  overlap_areas: string[];
  similarity_score: number | null;
  status: ContradictionStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  detected_at: string;
  /** Joined decision objects when using select with foreign keys. */
  decision_a?: Decision;
  decision_b?: Decision;
}

export interface AuthSession {
  jwt: string;
  expiresAt: Date;
  memberId: string;
  orgId: string;
  orgName: string;
  role: MemberRole;
  authorName: string;
}

export interface ExchangeTokenResponse {
  token: string;
  expires_at: string;
  member_id: string;
  org_id: string;
  org_name: string;
  role: MemberRole;
  author_name: string;
  auth_mode: string;
}
