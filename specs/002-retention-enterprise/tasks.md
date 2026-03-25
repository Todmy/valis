# Tasks: Retention, Collaboration & Enterprise Readiness

**Input**: Design documents from `/specs/002-retention-enterprise/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in spec. Test tasks omitted. Add via `/speckit.checklist` if needed.

**Organization**: Tasks grouped by user story. 5 stories (P1-P5), independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1-US5)
- Paths relative to repo root

## Path Conventions

- **CLI package**: `packages/cli/src/`, `packages/cli/test/`
- **Supabase**: `supabase/migrations/`, `supabase/functions/`
- **Root**: `package.json`, `tsconfig.base.json`

---

## Phase 1: Setup

**Purpose**: Schema migration, extended types, new modules scaffolded

- [ ] T001 Extend types (Decision: add replaces, depends_on, status_changed_by/at/reason; Member: add api_key, revoked_at; new AuditEntry, Contradiction, StoreArgs extensions, LifecycleArgs, JWT types) in packages/cli/src/types.ts
- [ ] T002 Create Postgres migration 002_retention.sql: ALTER members ADD api_key/revoked_at, ALTER decisions ADD replaces/depends_on/status_changed_by/at/reason, CREATE audit_entries table, CREATE contradictions table, new indexes, new RPC functions (find_contradictions, get_audit_trail, get_lifecycle_history), updated RLS policies for JWT auth (coexist with legacy) in supabase/migrations/002_retention.sql
- [ ] T003 [P] Add error message constants (contradiction_detected, invalid_transition, admin_required, key_revoked, token_expired, member_not_found) in packages/cli/src/errors.ts (extend)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Auth, audit, and client modules that all user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Implement JWT client (exchangeToken: call Edge Function with API key → cache JWT — on 401 during token exchange (key revoked) log warning with pending queue count and skip flush do not crash, refreshToken: refresh before expiry, getToken: return cached or refresh, isJwtMode: check config auth_mode) in packages/cli/src/auth/jwt.ts
- [ ] T005 [P] Implement RBAC module (checkPermission: verify role for action, canSupersede: admin or original author check, canRotateKey: admin only, canRevokeMember: admin only) in packages/cli/src/auth/rbac.ts
- [ ] T006 [P] Implement audit writer (createAuditEntry: insert via Supabase, buildAuditPayload: construct from action/target/member) in packages/cli/src/auth/audit.ts
- [ ] T007 Extend Supabase client: add getSupabaseJwtClient (createClient with accessToken callback using jwt.ts), add lifecycle methods (changeDecisionStatus, getDecisionHistory, findDependents, storeAuditEntry, findContradictionCandidates via affects && overlap, getAuditTrail), keep legacy getSupabaseClient intact for backward compat in packages/cli/src/cloud/supabase.ts (extend)
- [ ] T008 [P] Extend Qdrant client: add getSimilarity method (cosine distance between two decision vectors by ID, return 0.0-1.0), extend upsertDecision payload with replaces/depends_on/status fields in packages/cli/src/cloud/qdrant.ts (extend)
- [ ] T009 [P] Extend config store logic: update loadConfig/saveConfig to handle new auth_mode ('legacy'|'jwt'), member_api_key, member_id fields (type interfaces defined in T001) in packages/cli/src/config/store.ts (extend)
- [ ] T025 Implement Edge Function exchange-token (Deno runtime, look up member by api_key or org by api_key, validate not revoked, mint JWT with jose HS256 1h expiry, include sub/role/org_id/member_role/author_name claims, sign with JWT_SECRET env var) in supabase/functions/exchange-token/index.ts per edge-functions contract — moved from Phase 6 to Foundational because T004 (JWT client) depends on this Edge Function

**Checkpoint**: Auth module compiles, Supabase/Qdrant clients extended, audit writer ready, exchange-token Edge Function deployed

---

## Phase 3: User Story 1 — Decision Lifecycle (Priority: P1) 🎯

**Goal**: Status transitions, replaces/depends_on relationships, lifecycle MCP tool, search ranking by status

**Independent Test**: Store "Use REST for APIs." Store replacement with `replaces` link. Verify original superseded, search ranks replacement first.

### Implementation for User Story 1

- [ ] T010 [US1] Implement Edge Function change-status (Deno runtime, validate transition rules per FR-001 permissions, UPDATE decision status + status_changed_by/at/reason, find dependents if deprecated, resolve open contradictions via SQL: `UPDATE contradictions SET status='resolved', resolved_at=now() WHERE (decision_a_id = $1 OR decision_b_id = $1) AND status = 'open'`, create audit entry, use service_role key) in supabase/functions/change-status/index.ts per edge-functions contract
- [ ] T011 [US1] Extend valis_store handler: add replaces param (validate target exists + same org, check RBAC canSupersede, call change-status on target to supersede, include superseded info in response), add depends_on param (validate all IDs exist in same org), add status param (active/proposed) in packages/cli/src/mcp/tools/store.ts (extend)
- [ ] T012 [US1] Implement valis_lifecycle MCP tool handler (deprecate: call change-status Edge Function, promote: call change-status, history: call getDecisionHistory RPC, return formatted response) in packages/cli/src/mcp/tools/lifecycle.ts per mcp-tools contract
- [ ] T013 [US1] Register valis_lifecycle tool in MCP server (add tool definition with schema, wire handler) in packages/cli/src/mcp/server.ts (extend)
- [ ] T014 [US1] Extend valis_search handler: add status field to SearchResult, rank active above deprecated/superseded at equal relevance, include replaced_by reverse lookup in results in packages/cli/src/mcp/tools/search.ts (extend)
- [ ] T015 [P] [US1] Extend valis_context handler: filter out deprecated/superseded from primary results, include them in a separate "historical" group if relevant in packages/cli/src/mcp/tools/context.ts (extend)
- [ ] T016 [US1] Extend dashboard command: add lifecycle stats section (Active/Deprecated/Superseded/Proposed counts), show dependency warnings for flagged decisions in packages/cli/src/commands/dashboard.ts (extend)

**Checkpoint**: Decision lifecycle works end-to-end. Store with replaces auto-supersedes. Search ranks by status. Lifecycle tool deprecates/promotes.

---

## Phase 4: User Story 2 — Cross-Session Real-Time Push (Priority: P2)

**Goal**: Supabase Realtime subscription delivers cross-session notifications via MCP channels

**Independent Test**: Two machines, same org. Dev A stores. Dev B gets push notification within 5 seconds.

### Implementation for User Story 2

- [ ] T017 [US2] Implement Realtime subscription client (subscribeToOrg: supabase.channel().on('postgres_changes', INSERT+UPDATE on decisions filtered by org_id), handleRealtimeEvent: parse payload.new, dedup against local stores, build channel event, unsubscribe on exit. Note: Supabase Realtime does NOT buffer or replay past events — on reconnect, client resubscribes fresh with no backlog per FR-008) in packages/cli/src/cloud/realtime.ts
- [ ] T018 [US2] Extend channel push: add buildRemoteDecisionEvent (origin: 'remote'), add buildDeprecationEvent, add buildContradictionEvent in packages/cli/src/channel/push.ts (extend)
- [ ] T019 [US2] Integrate Realtime into serve command: after MCP server start, subscribe to org Realtime channel, on event → push to local MCP channel, on disconnect → log warning + set status degraded, on exit → unsubscribe in packages/cli/src/commands/serve.ts (extend)
- [ ] T020 [P] [US2] Extend status command: show Realtime connection status (connected/disconnected/degraded), show auth mode in packages/cli/src/commands/status.ts (extend)

**Checkpoint**: `valis serve` subscribes to Realtime. Cross-session push delivers within 5 seconds. Graceful degradation on disconnect.

---

## Phase 5: User Story 3 — Contradiction Detection (Priority: P3)

**Goal**: Detect contradictions on store, warn user, push to active sessions, show in dashboard

**Independent Test**: Store "Use REST" with affects:["api"]. Store "Use GraphQL" with affects:["api"]. Both stored, contradiction warning returned.

### Implementation for User Story 3

- [ ] T021 [US3] Implement contradiction detection (detectContradictions: query active decisions with overlapping affects via SQL &&, for each candidate compute Qdrant cosine similarity, flag if overlap + similarity > 0.7, enforce ordered pair insertion (smaller UUID as decision_a_id) to prevent duplicate contradiction records per data-model.md, insert into contradictions table, return list) in packages/cli/src/contradiction/detect.ts per research.md two-tier strategy
- [ ] T022 [US3] Integrate contradiction detection into store pipeline: after successful dual write, call detectContradictions, if found: include warnings in StoreResponse, build contradiction channel events, create audit entries in packages/cli/src/mcp/tools/store.ts (extend)
- [ ] T023 [US3] Implement contradiction resolution: detect.ts exports a `resolveContradictions` helper that is called from the store pipeline (after change-status response returns flagged_dependents), NOT from the Edge Function. The Edge Function handles contradiction resolution directly via SQL (see T010). The CLI-side helper updates local state and builds channel events for resolved contradictions in packages/cli/src/contradiction/detect.ts (extend)
- [ ] T024 [P] [US3] Extend dashboard command: add "Contradictions: N open" section, show specific pairs with area overlap in packages/cli/src/commands/dashboard.ts (extend)

**Checkpoint**: Contradiction detection fires on area overlap. Warnings in store response. Dashboard shows count. Resolution on deprecate.

---

## Phase 6: User Story 4 — Identity & Access Control (Priority: P4)

**Goal**: Per-member API keys, JWT auth, key rotation, revocation, audit trail CLI

**Independent Test**: 3 members with own keys. Store attributed to member. Revoke one key → 401. Rotate org key → member keys unaffected.

### Implementation for User Story 4

- _(T025 exchange-token moved to Phase 2 Foundational — required by T004 JWT client)_
- [ ] T026 [P] [US4] Implement Edge Function rotate-key (Deno runtime, authenticate via Bearer, verify admin, rotate api_key/invite_code/member_key, create audit entry) in supabase/functions/rotate-key/index.ts per edge-functions contract
- [ ] T027 [P] [US4] Implement Edge Function revoke-member (Deno runtime, authenticate, verify admin, if target_member_id equals caller's member_id return warning and require confirmation flag (force: true) to proceed, SET revoked_at, create audit entry) in supabase/functions/revoke-member/index.ts per edge-functions contract
- [ ] T028 [US4] Extend Edge Function join-org: generate per-member API key (tmm_ + 32 hex), INSERT into members.api_key, return member key in response alongside org key in supabase/functions/join-org/index.ts (extend)
- [ ] T029 [US4] Implement migrate-auth CLI command (verify legacy auth, call exchange-token, update config with auth_mode:'jwt' + member_api_key + member_id, test round-trip, print migration status) in packages/cli/src/commands/migrate-auth.ts per cli-commands contract
- [ ] T030 [US4] Implement admin audit CLI command (valis admin audit: load config, call getAuditTrail RPC, format chronological table with member/action/target/timestamp, support --org/--member/--limit flags) in packages/cli/src/commands/admin-audit.ts per cli-commands contract
- [ ] T031 [US4] Register migrate-auth and admin audit commands in CLI entry point in packages/cli/bin/valis.ts (extend)

**Checkpoint**: Per-member keys issued at join. JWT auth works. Key rotation/revocation immediate. Audit trail viewable.

---

## Phase 7: User Story 5 — Observability & Unit Economics (Priority: P5)

**Goal**: `valis admin metrics` shows activation, engagement, COGS, churn

**Independent Test**: `valis admin metrics` shows active orgs, avg decisions, COGS estimates, activation funnel.

### Implementation for User Story 5

- [ ] T032 [US5] Implement metrics computation (computeMetrics: query rate_limits + orgs tables with service_role key, derive active members from count of distinct authors in decisions table within period (or from audit_entries if available), calculate active orgs 7d/30d, avg decisions/searches per org, COGS estimate from unit-economics.md constants, activation funnel from org created_at vs first rate_limits entry, churn detection for 30d idle orgs) in packages/cli/src/metrics/compute.ts
- [ ] T033 [US5] Implement admin metrics CLI command (valis admin metrics: require service_role key, call computeMetrics, format table output with picocolors, support --json and --period flags) in packages/cli/src/commands/admin-metrics.ts per cli-commands contract
- [ ] T034 [US5] Register admin metrics command in CLI entry point in packages/cli/bin/valis.ts (extend)

**Checkpoint**: `valis admin metrics` returns activation funnel, COGS estimates within 5 seconds.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation, integration, documentation

- [ ] T035 End-to-end flow test: init → migrate-auth → serve (2 sessions) → store with replaces → verify supersede → cross-session push → contradiction detection → dashboard → admin metrics → admin audit (manual validation per quickstart.md)
- [ ] T036 [P] Update README.md with Phase 2 features (lifecycle, cross-session push, per-member auth, contradiction detection)
- [ ] T037 [P] Update AGENTS.md with lifecycle instructions (how agents should handle deprecated decisions, contradiction warnings, replaces usage)
- [ ] T038 Build and dry-run npm publish from packages/cli (verify new files included, no missing deps)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories. Includes T025 (exchange-token Edge Function, moved from US4) because T004 JWT client depends on it.
- **US1 (Phase 3)**: Depends on Foundational — first increment
- **US2 (Phase 4)**: Depends on Foundational. Can parallel with US1 (different files).
- **US3 (Phase 5)**: Depends on Foundational + US1 partially (store pipeline calls change-status; Edge Function resolves contradictions via SQL, CLI-side helper handles local state)
- **US4 (Phase 6)**: Depends on Foundational. Can parallel with US1/US2. Note: T025 (exchange-token) moved to Phase 2 Foundational; remaining US4 tasks are T026-T031.
- **US5 (Phase 7)**: Depends on Setup only (uses service_role, not JWT). Can parallel with US1-US4.
- **Polish (Phase 8)**: Depends on all stories complete

### User Story Dependencies

```
Foundational ──┬── US1 (lifecycle) ── US3 (contradiction, needs change-status)
               ├── US2 (realtime)  ── can parallel with US1
               ├── US4 (auth)      ── can parallel with US1/US2
               └── US5 (metrics)   ── can parallel with all (service_role only)
```

### Parallel Opportunities

Within Phase 2 (Foundational):
- T005, T006 can run in parallel (RBAC, audit — different files)
- T008, T009 can run in parallel (Qdrant extension, config extension)

Within US1:
- T015 can parallel with T014 (context vs search — different files)

Within US4:
- T026, T027 can parallel (rotate-key, revoke-member — different Edge Functions)

Cross-story parallelism:
- US2 (T017-T020) can run in parallel with US1 (T010-T016)
- US4 (T026-T031, T025 moved to Foundational) can run in parallel with US1/US2
- US5 (T032-T034) can run in parallel with everything

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 — Decision Lifecycle
4. **STOP and VALIDATE**: Status transitions work, replaces auto-supersedes, search ranks by status
5. This alone delivers: living knowledge base instead of static dump

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 (lifecycle) → Decisions evolve, trust maintained
3. US2 (realtime) → Cross-session awareness
4. US3 (contradiction) → Trustworthy brain
5. US4 (auth) → Enterprise-ready
6. US5 (metrics) → Business instrumentation
7. Polish → Ready for release

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to spec.md user story for traceability
- Each user story phase is independently testable at its checkpoint
- Commit after each task or logical group
- Stop at any checkpoint to validate — each phase adds value
- All file paths reference plan.md project structure
- Backward compatibility: MVP installations MUST work after Phase 2 deployment
- Edge Functions use Deno runtime with esm.sh imports (not Node.js)
