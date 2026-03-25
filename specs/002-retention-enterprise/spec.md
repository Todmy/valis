# Feature Specification: Retention, Collaboration & Enterprise Readiness

**Feature Branch**: `002-retention-enterprise`
**Created**: 2026-03-23
**Status**: Draft
**Input**: Post-MVP roadmap — Phase 2 features deferred from 001-valis-mvp

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Decision Lifecycle (Priority: P1)

Decisions in the team brain evolve over time. A Tech Lead deprecates
an outdated decision ("we use REST") by marking it deprecated. When a
developer stores a replacement decision ("we switched to gRPC for
inter-service comms"), the system automatically marks the old decision
as superseded and links the two. Agents searching the brain see the
current decision first, with a note that it replaced a previous one.
Deprecated and superseded decisions remain searchable for historical
context but are clearly labeled.

Decisions can also link to each other via dependencies: "our caching
strategy depends on our database choice." When a dependency is
deprecated, downstream decisions are flagged for review.

**Why this priority**: Without lifecycle management, the brain
accumulates stale and contradictory guidance. Within months of active
use, developers lose trust because they can't tell which decisions are
current. This is the #1 retention risk.

**Independent Test**: Store a decision "Use REST for all APIs." Later,
store a replacement "Switch to gRPC for inter-service" with a
`replaces` link. Verify: original is automatically superseded, new
decision is active, search returns the new one first with "replaces"
context, and the old one is still findable with a superseded label.

**Acceptance Scenarios**:

1. **Given** an active decision, **When** an admin or the original
   author calls `valis_store` with `replaces: <decision_id>`,
   **Then** the new decision is stored as `active` and the replaced
   decision transitions to `superseded` automatically.
2. **Given** an active decision, **When** any member changes its
   status to `deprecated` via CLI or MCP tool, **Then** the decision
   is marked `deprecated` with a timestamp and the member who changed
   it. Any member can deprecate or promote; only admin or original
   author can replace (supersede).
3. **Given** a decision with status `proposed`, **When** any member
   promotes it to `active`, **Then** the status transitions and the
   change is recorded with who and when.
4. **Given** a search query, **When** results include superseded or
   deprecated decisions, **Then** they appear below active decisions
   and are clearly labeled with their status and replacement link.
5. **Given** decision A with `depends_on: [B]`, **When** decision B
   is deprecated, **Then** the system flags decision A for review
   (channel notification if available, visible in dashboard/search).
6. **Given** a status transition, **When** it completes, **Then** an
   audit record captures: who changed it, from what status, to what
   status, and why (optional reason text).
7. **Given** any decision, **When** its full history is requested,
   **Then** the system returns all status changes with timestamps,
   actors, and reasons.

---

### User Story 2 - Cross-Session Real-Time Push (Priority: P2)

Dev A stores a decision "We chose PostgreSQL for user data." Within
seconds, Dev B — working on a different machine in the same org —
receives a push notification in their active session. Dev B's agent
sees the decision in context without calling search. The team brain
is now a live, real-time awareness layer, not just a database.

When Dev B's session is offline or channels are unavailable, nothing
breaks. They still find the decision via search on next query.

**Why this priority**: In the MVP, push only works within the local
session. Cross-session push is what transforms Valis from "shared
database with search" into "real-time team awareness" — the core
differentiator for retention and the "team brain" promise.

**Independent Test**: Two developers on different machines, same org.
Dev A stores a decision. Dev B receives it as a channel notification
within 5 seconds without searching.

**Acceptance Scenarios**:

1. **Given** Dev A and Dev B in the same org on different machines,
   **When** Dev A stores a decision, **Then** Dev B's active session
   receives a channel notification within 5 seconds containing the
   decision summary, author, and type.
2. **Given** 5 developers in the same org with active sessions,
   **When** one stores a decision, **Then** all 4 others receive the
   notification (fan-out).
3. **Given** Dev B's session has no channel support, **When** Dev A
   stores a decision, **Then** Dev B's session is unaffected — no
   error, no crash. The decision is available via search.
4. **Given** the real-time service is down, **When** a decision is
   stored, **Then** the store succeeds normally. Push fails silently.
   The decision is available via search.
5. **Given** Dev B reconnects after being offline, **When** their
   session starts, **Then** they do NOT receive a backlog of missed
   push notifications (push is ephemeral, not buffered).
6. **Given** a cross-session push notification, **When** it arrives,
   **Then** it includes: decision summary, type, author, and affected
   areas — enough context for the agent to incorporate it.
7. **Given** multiple orgs on the same infrastructure, **When** Org A
   stores a decision, **Then** Org B receives zero notifications
   (tenant isolation on real-time channel).

---

### User Story 3 - Contradiction Detection (Priority: P3)

Dev A stored "Use REST for all external APIs" last week. Today, Dev B
stores "Use GraphQL for the public API." The system detects that both
decisions affect the same area ("api" / "external") with opposing
content. Dev B's store succeeds, but they receive a warning:
"Potential contradiction with decision #47 by Olena: 'Use REST for all
external APIs.' Both remain active — resolve via deprecation or
replacement."

If Dev A has an active session, they also receive a push notification
about the contradiction. The dashboard shows a "contradictions" count.

**Why this priority**: Without contradiction detection, two developers
can unknowingly maintain opposing decisions. Agents follow whichever
they find first — leading to inconsistent codebases. Contradiction
detection is what makes the brain *trustworthy* — not just large.

**Independent Test**: Store "Use REST for all APIs" with
`affects: ["api"]`. Then store "Use GraphQL for public API" with
`affects: ["api"]`. Verify: both stored, contradiction warning
returned to the second storer, notification sent to active sessions.

**Acceptance Scenarios**:

1. **Given** an active decision affecting area "auth", **When** a new
   decision is stored affecting "auth" with semantically opposing
   content, **Then** the store succeeds AND returns a contradiction
   warning with the conflicting decision's ID, summary, and author.
2. **Given** a detected contradiction, **When** both decisions are
   stored, **Then** both remain `active` until explicitly resolved
   (neither is auto-deprecated).
3. **Given** a contradiction is detected, **When** the storing
   developer is in an active session with channels, **Then** they
   receive a channel notification flagging the contradiction.
4. **Given** a contradiction is detected, **When** other org members
   have active sessions, **Then** they receive a push notification
   about the contradiction (via cross-session push from US2).
5. **Given** a contradiction between decisions A and B, **When** a
   member replaces A with B (or deprecates A), **Then** the
   contradiction is considered resolved and no longer flagged.
6. **Given** the dashboard command, **When** contradictions exist,
   **Then** the dashboard shows a "contradictions" count and the
   specific pairs.
7. **Given** two decisions in different `affects` areas, **When** both
   are stored, **Then** no contradiction is flagged (area overlap is
   required).

---

### User Story 4 - Identity & Access Control (Priority: P4)

When a new member joins an org, they receive their own personal API
key. Every store, search, status change, and export is attributed to
that specific member — not just an author name string. An admin can
revoke a single member's access without disrupting the rest of the
team. An admin can rotate the org-level API key or any member's key
in case of compromise. The audit trail shows exactly who did what
and when.

Roles control access: admins can manage members, rotate keys, and
change org settings. Regular members can store, search, and change
decision status.

**Why this priority**: The MVP uses a single org-level API key and
self-reported author names. This works for small trusted teams but
blocks enterprise adoption: no individual accountability, no
revocation, no audit trail. Enterprise security reviews require
per-member credentials and role-based access.

**Independent Test**: Create an org with 3 members, each with their
own API key. Member A stores a decision — audit trail shows Member A.
Admin revokes Member B's key — Member B can no longer access the
system. Admin rotates the org key — all existing member keys continue
to work (org key is separate from member keys).

**Acceptance Scenarios**:

1. **Given** a new member joins via invite code, **When** they join,
   **Then** a unique per-member API key is issued and returned along
   with org context.
2. **Given** a member with their own API key, **When** they store a
   decision, **Then** the `author` field is set from their member
   record (not self-reported) and the operation is logged in the
   audit trail.
3. **Given** an admin, **When** they revoke a member's API key,
   **Then** the member's key is immediately invalid and all
   subsequent requests with it return 401.
4. **Given** an admin, **When** they rotate the org-level API key,
   **Then** the old org key is invalidated immediately and the admin
   receives the new key. Member keys are unaffected.
5. **Given** a member (non-admin), **When** they attempt to rotate
   keys or remove members, **Then** they receive a 403 "admin
   required" error.
6. **Given** any state-changing operation, **When** it completes,
   **Then** an audit record is created with: member ID, action type,
   target, timestamp, and result.
7. **Given** an admin, **When** they request the audit trail via CLI,
   **Then** they see a chronological list of all org actions with
   member attribution.
8. **Given** the existing MVP init flow, **When** Phase 2 auth is
   deployed, **Then** existing org-level API keys continue to work
   (backward compatible) until the admin migrates to per-member keys.

---

### User Story 5 - Observability & Unit Economics (Priority: P5)

The system tracks operational metrics from Day 1: how many decisions
are stored per org per day, how many searches, which orgs are active,
and what resources each org consumes. An internal dashboard (CLI
command) shows activation rates (init to first store), daily active
orgs, and COGS per org. This data feeds into pricing decisions and
identifies at-risk orgs (low activity = churn risk).

**Why this priority**: The MVP rate_limits table tracks daily operation
counts but no tooling exists to analyze them. Without instrumentation,
the team is blind to activation, engagement, and cost — the three
metrics that determine whether Valis is a viable business.

**Independent Test**: Run `valis admin metrics` and verify it shows:
active orgs this week, avg decisions per org, avg searches per org,
estimated COGS per org, and activation funnel (orgs created →
first store → weekly active).

**Acceptance Scenarios**:

1. **Given** an org with activity, **When** the platform operator runs
   `valis admin metrics` (requires service_role key), **Then** they
   see: total orgs, active orgs (7d/30d), avg decisions/org, avg
   searches/org.
2. **Given** rate_limits data, **When** metrics are computed, **Then**
   estimated COGS per org is calculated based on operation counts and
   known infrastructure costs.
3. **Given** org creation timestamps and first-store timestamps,
   **When** activation funnel is computed, **Then** it shows: orgs
   created → first store within 24h → weekly active rate.
4. **Given** an org with zero activity in the last 30 days, **When**
   churn detection runs, **Then** the org is flagged as at-risk.
5. **Given** metrics data, **When** exported, **Then** it produces
   a JSON report suitable for external analysis tools.

---

### Edge Cases

- What happens when a member with a revoked key has pending offline
  decisions queued? The offline queue is flushed with the member's
  last-known-valid key. If that key is revoked before flush, the
  queued decisions are lost with a warning logged locally.
- What happens during the migration from org-level to per-member
  keys? Both auth methods coexist. The org-level key works as before.
  Per-member keys are issued on next join or explicit migration
  command. The admin decides when to deprecate the org-level key.
- What happens when contradiction detection finds a false positive?
  It's a warning, not a block. Both decisions remain active.
  Developers can dismiss the contradiction or resolve it.
- What happens when Supabase Realtime is rate-limited? Push
  notifications are dropped silently. Search/store still work.
  Status command shows "push: degraded."
- What happens when a decision is superseded but the replacement is
  later deprecated? The original decision remains superseded. Neither
  is automatically reactivated — manual intervention required.
- What happens when two contradicting decisions are stored
  simultaneously by different members? Both succeed. Both get
  contradiction warnings. The race condition is acceptable — neither
  is auto-resolved.
- What happens when an admin revokes their own key? The operation
  succeeds. The admin loses access. Another admin (if one exists)
  must issue a new key. If no other admin exists, org recovery
  requires support intervention.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support decision status transitions:
  `proposed → active`, `active → deprecated`, `active → superseded`.
  Any member can deprecate or promote. Only admin or original author
  can replace (supersede). Every transition MUST record who, when,
  and optional reason.
- **FR-002**: System MUST support `replaces` relationship: when a new
  decision replaces an existing one, the replaced decision MUST
  transition to `superseded` automatically.
- **FR-003**: System MUST support `depends_on` relationship: when a
  dependency is deprecated, downstream decisions MUST be flagged for
  review.
- **FR-004**: System MUST preserve full status change history per
  decision (audit trail of transitions).
- **FR-005**: Search results MUST rank active decisions above
  deprecated/superseded ones and clearly label non-active statuses.
- **FR-006**: System MUST deliver cross-session push notifications
  via real-time subscriptions when a decision is stored, with
  tenant isolation (org-scoped channels).
- **FR-007**: Cross-session push MUST degrade gracefully: if the
  real-time service is unavailable, store operations MUST succeed
  and decisions MUST remain searchable via pull.
- **FR-008**: Push notifications MUST NOT be buffered or replayed —
  they are ephemeral. Missed notifications are recovered via search.
- **FR-009**: System MUST detect potential contradictions when a new
  decision is stored that affects the same areas as an existing active
  decision with semantically opposing content.
- **FR-010**: Contradiction detection MUST return a warning to the
  storing user, not block the store. Both decisions remain active.
- **FR-011**: Detected contradictions MUST be pushed to active
  sessions (if cross-session push is available) and visible in
  the dashboard.
- **FR-012**: System MUST issue per-member API keys at join time,
  uniquely identifying each member.
- **FR-013**: System MUST enforce role-based access: admin role for
  key rotation, member management, and org settings; member role for
  store, search, and status changes.
- **FR-014**: System MUST support revoking individual member API keys
  with immediate effect.
- **FR-015**: System MUST support rotating org-level and member-level
  API keys (admin only).
- **FR-016**: Every state-changing operation MUST be recorded in an
  audit trail with: member ID, action, target, timestamp, result.
- **FR-017**: Auth migration MUST be backward compatible — existing
  org-level API keys continue to work until explicitly deprecated
  by the admin.
- **FR-018**: System MUST track per-org daily metrics: store count,
  search count, active members, and compute activation and churn
  indicators.
- **FR-019**: System MUST provide a platform operator CLI command
  (`valis admin metrics`, requires service_role key) for internal
  metrics reporting (active orgs, COGS estimates, activation funnel,
  churn risk). This is not an org-level feature.
- **FR-020**: Client authentication MUST use member-scoped tokens
  so that database-level row security is enforced natively — not via
  application-level workarounds.

### Key Entities

- **Decision** (extended): Gains `replaces` (optional reference to
  another decision), `depends_on` (optional list of decision
  references), and full status transition history. Status is now
  actively managed, not static.
- **Member** (extended): Gains a per-member API key (unique,
  revocable), and serves as the identity for all mutations and
  audit records.
- **AuditEntry**: A new entity recording every state-changing
  operation. Has member reference, action type, target entity,
  timestamp, previous state, new state, and optional reason.
- **Contradiction**: A derived record linking two conflicting active
  decisions. Has decision pair references, affected area overlap,
  detection timestamp, and resolution status (open/resolved).

## Clarifications

### Session 2026-03-23

- Q: Who can change a decision's status (deprecate, promote, replace)? → A: Any member can deprecate or promote; only admin or original author can replace (supersede).
- Q: Is `valis admin metrics` org-scoped or platform-scoped? → A: Platform-scoped (requires service_role key, not per-member auth). This is an operator command for the Valis deployer, not an org admin feature.

## Assumptions

- Supabase Realtime is available on the current plan and supports
  channel subscriptions scoped by org_id.
- Contradiction detection uses `affects` area overlap + embedding
  similarity — not LLM calls. If embedding similarity is insufficient,
  area overlap alone is used as a simpler heuristic.
- The MVP's org-level API key remains functional during migration.
  No forced migration — admins opt in to per-member keys.
- Rate_limits table from MVP provides the foundation for metrics.
  No additional external analytics infrastructure is required for
  Phase 2 instrumentation.
- Per-member JWT tokens replace `service_role` key for CLI client
  auth. Edge Functions continue to use `service_role` key (they are
  server-side trusted code).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When a decision is replaced, the superseded decision's
  status updates within 1 second and search correctly ranks the
  replacement above the original.
- **SC-002**: Cross-session push delivers a notification to all
  active org members within 5 seconds of a store operation.
- **SC-003**: Contradiction detection flags 90%+ of decisions stored
  in the same `affects` area as an existing active decision with
  opposing content (measured against a test corpus).
- **SC-004**: Per-member API key revocation takes effect immediately
  — a revoked key returns 401 on the next request with zero grace
  period.
- **SC-005**: The audit trail records 100% of state-changing
  operations with correct member attribution.
- **SC-006**: `valis admin metrics` returns activation funnel, active
  org counts, and COGS estimates within 5 seconds.
- **SC-007**: Existing MVP installations continue to function without
  changes after Phase 2 deployment (backward compatibility).
- **SC-008**: Cross-session push respects tenant isolation — zero
  cross-org notification leakage verified across 2+ test orgs.
- **SC-009**: Decision lifecycle operations (status change, replace,
  depend) complete within 500ms from the user's perspective.
