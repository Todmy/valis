# Data Model: Retention, Collaboration & Enterprise Readiness

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-23
**Extends**: `/specs/001-valis-mvp/data-model.md`

## Schema Changes (Migration 002)

All changes are additive. No columns removed or types changed.

### Member (extended)

| Field | Type | Constraints | Change |
|-------|------|-------------|--------|
| api_key | text | UNIQUE, nullable | ADD |
| revoked_at | timestamptz | nullable | ADD |

**api_key**: Per-member API key, format `tmm_` + 32 hex chars. Null
for legacy members (use org-level key). Unique globally.

**revoked_at**: When set, key is invalid. Check: `revoked_at IS NULL`.

**Index**: `members.api_key` (unique, partial where `api_key IS NOT NULL`).

### Decision (extended)

| Field | Type | Constraints | Change |
|-------|------|-------------|--------|
| replaces | UUID | nullable, FK → decisions.id | ADD |
| depends_on | UUID[] | default '{}' | ADD |
| status_changed_by | text | nullable | ADD |
| status_changed_at | timestamptz | nullable | ADD |
| status_reason | text | nullable | ADD |

**replaces**: When set, the referenced decision transitions to
`superseded` automatically via trigger or application logic.

**depends_on**: Array of decision UUIDs. When a dependency is
deprecated, downstream decisions are flagged.

**status_changed_by**: Member `author_name` who last changed status.
Null for decisions that haven't had status changes.

**status_changed_at**: Timestamp of last status change.

**status_reason**: Optional reason text for the status change.

**Index**: `decisions.replaces` (for reverse lookup: "what replaced me?").

### AuditEntry (new)

Records every state-changing operation.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, auto-generated |
| org_id | UUID | NOT NULL, FK → orgs.id |
| member_id | UUID | NOT NULL, FK → members.id |
| action | text | NOT NULL, enum (see below) |
| target_type | text | NOT NULL, enum: decision/member/org |
| target_id | UUID | NOT NULL |
| previous_state | jsonb | nullable |
| new_state | jsonb | nullable |
| reason | text | nullable |
| created_at | timestamptz | NOT NULL, default now() |

**action enum**: `decision_stored`, `decision_deprecated`,
`decision_superseded`, `decision_promoted`, `decision_depends_added`,
`member_joined`, `member_revoked`, `key_rotated`,
`org_key_rotated`, `contradiction_detected`, `contradiction_resolved`

**Identity**: UUID primary key.
**RLS**: Scoped by `org_id` via JWT claims (read-only for members,
write via application logic with service_role in Edge Functions).

**Index**: `audit_entries.org_id` + `audit_entries.created_at` DESC
(for chronological audit trail per org).

### Contradiction (new)

Tracks detected contradictions between active decisions.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, auto-generated |
| org_id | UUID | NOT NULL, FK → orgs.id |
| decision_a_id | UUID | NOT NULL, FK → decisions.id |
| decision_b_id | UUID | NOT NULL, FK → decisions.id |
| overlap_areas | text[] | NOT NULL |
| similarity_score | real | nullable, 0.0-1.0 |
| status | text | NOT NULL, default 'open', enum: open/resolved |
| resolved_by | UUID | nullable, FK → members.id |
| resolved_at | timestamptz | nullable |
| detected_at | timestamptz | NOT NULL, default now() |

**Identity**: UUID primary key.
**Uniqueness**: `(decision_a_id, decision_b_id)` unique (ordered:
smaller UUID first to prevent duplicates).

**Index**: `contradictions.org_id` + `contradictions.status`
(for dashboard: open contradictions per org).

## Relationships (updated)

```
Organization 1 ──── * Member (gains api_key, revoked_at)
Organization 1 ──── * Decision (gains replaces, depends_on)
Organization 1 ──── * AuditEntry (new)
Organization 1 ──── * Contradiction (new)
Organization 1 ──── * RateLimit (unchanged)

Decision 1 ──── 0..1 Decision (replaces → superseded)
Decision 1 ──── * Decision (depends_on, array)
Decision * ──── * Contradiction (via decision_a_id, decision_b_id)

Member 1 ──── * AuditEntry (member_id)
```

## State Transitions (updated)

### Decision.status

```
proposed → active       (any member can promote)
active → deprecated     (any member)
active → superseded     (admin or original author, via replaces)
```

**Trigger on replaces**: When a decision is stored with
`replaces: <id>`, the target transitions to `superseded` and an
audit entry is created. If the target is not `active`, the store
succeeds but no transition occurs (warning returned).

**Permission model**:
- `deprecated`: any org member
- `superseded`: admin or original author only (via `replaces`)
- `proposed → active`: any org member

### Contradiction.status

```
open → resolved
```

Resolved when either decision in the pair is deprecated, superseded,
or explicitly dismissed via `valis dismiss-contradiction <id>`.

## Validation Rules (new)

- `members.api_key`: format `tmm_` + 32 hex chars when present.
- `audit_entries.action`: must be one of the defined enum values.
- `contradictions`: `decision_a_id < decision_b_id` (enforced by
  application logic for ordered pair dedup).
- `decisions.replaces`: must reference an existing decision in the
  same org. Cross-org references rejected.
- `decisions.depends_on`: all UUIDs must reference existing decisions
  in the same org.

## RLS Policy Changes

### Legacy mode (coexist with MVP)

Existing policies using `current_setting('app.org_id', true)` remain.
They work when `service_role` key sets the context.

### JWT mode (new)

Additional policies for JWT-authenticated clients:

```sql
-- Decisions: JWT-based org isolation
CREATE POLICY decisions_jwt ON decisions
  FOR ALL
  USING (org_id::text = (select auth.jwt()->>'org_id'))
  WITH CHECK (org_id::text = (select auth.jwt()->>'org_id'));

-- Audit entries: read-only for org members
CREATE POLICY audit_read_jwt ON audit_entries
  FOR SELECT
  USING (org_id::text = (select auth.jwt()->>'org_id'));

-- Contradictions: read-only for org members
CREATE POLICY contradictions_read_jwt ON contradictions
  FOR SELECT
  USING (org_id::text = (select auth.jwt()->>'org_id'));
```

Write operations on `audit_entries` and `contradictions` are
performed by Edge Functions using `service_role` key (trusted
server-side code).

## Data Volume Assumptions (Phase 2)

| Metric | Expected range |
|--------|---------------|
| Audit entries per org/day | 10-100 |
| Contradictions per org (open) | 0-10 |
| Status transitions per decision | 0-3 lifetime |
| Members with per-member keys | 3-50 per org |
| Realtime subscriptions | 1 per active session |
