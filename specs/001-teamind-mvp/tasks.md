# Tasks: Teamind MVP

**Input**: Design documents from `/specs/001-teamind-mvp/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in spec. Test tasks omitted. Add via `/speckit.checklist` if needed.

**Organization**: Tasks grouped by user story. 8 stories (P1-P8), independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1-US8)
- Paths relative to repo root

## Path Conventions

- **CLI package**: `packages/cli/src/`, `packages/cli/test/`, `packages/cli/bin/`
- **Supabase**: `supabase/migrations/`, `supabase/functions/`
- **Root**: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`

---

## Phase 1: Setup

**Purpose**: Monorepo scaffold, both packages compiling

- [ ] T001 Create root monorepo files: package.json (private workspace), pnpm-workspace.yaml, tsconfig.base.json (ES2022, NodeNext, strict), .gitignore (include .env*), LICENSE (Apache 2.0) at repo root
- [ ] T002 Create CLI package scaffold: packages/cli/package.json (teamind bin entry, all deps from research.md), packages/cli/tsconfig.json (extends base), packages/cli/.env.example (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, QDRANT_URL, QDRANT_API_KEY)
- [ ] T003 [P] Configure vitest in packages/cli/package.json (test script, vitest.config.ts)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, cloud clients, database schema, and cross-cutting modules that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Define shared types (Decision, RawDecision, TeamindConfig, API types) in packages/cli/src/types.ts per data-model.md
- [ ] T005 [P] Define 7 error message constants (cloud_unreachable, org_not_found, invite_invalid, free_tier_limit, secret_detected, qdrant_unreachable, dual_write_partial) in packages/cli/src/errors.ts
- [ ] T006 [P] Implement config store (loadConfig, saveConfig, updateConfig with 0600 permissions) in packages/cli/src/config/store.ts
- [ ] T007 [P] Implement manifest tracker (loadManifest, saveManifest, trackFile for uninstall) in packages/cli/src/config/manifest.ts
- [ ] T008 Create Supabase project config (supabase/config.toml) and Postgres schema (orgs, members, decisions, rate_limits tables with indexes, RLS policies, composite PK on rate_limits) in supabase/migrations/001_init.sql per data-model.md
- [ ] T009 [P] Implement Edge Function create-org (Deno runtime, import supabase-js via esm.sh, generate UUID, API key tm_ + 32 hex, invite code XXXX-XXXX, INSERT org + member in transaction, use service_role key) in supabase/functions/create-org/index.ts per edge-functions contract
- [ ] T010 [P] Implement Edge Function join-org (Deno runtime, validate invite code, check member limit, INSERT member, use service_role key) in supabase/functions/join-org/index.ts per edge-functions contract
- [ ] T012 Implement Supabase client (service_role key auth, set_config('app.org_id') for RLS, storeDecision, searchDecisions via RPC, getDashboardStats, healthCheck, batchStore for seed — all connections HTTPS enforced) in packages/cli/src/cloud/supabase.ts
- [ ] T013 [P] Implement Qdrant client (ensureCollection: create-if-not-exists with 384d cosine vectors + sparse BM25, upsertDecision, hybridSearch with org_id filter, getDashboardStats — all connections HTTPS enforced) in packages/cli/src/cloud/qdrant.ts
- [ ] T014 [P] Implement secret detection (10 regex patterns: AWS, Anthropic, OpenAI, GitHub, private key, JWT, DB URL, Slack, Stripe, generic) in packages/cli/src/security/secrets.ts
- [ ] T015 [P] Implement offline queue (appendToQueue, readQueue, flushQueue, getCount using pending.jsonl) in packages/cli/src/offline/queue.ts
- [ ] T016 [P] Implement content dedup (contentHash via SHA-256 of normalized text, isDuplicate with LRU cache 1000 entries, session_id awareness) in packages/cli/src/capture/dedup.ts

**Checkpoint**: Foundation ready — types compile, cloud clients connect, schema deployed, cross-cutting modules work

---

## Phase 3: User Story 1 — Organization Setup & Team Onboarding (Priority: P1) 🎯 MVP

**Goal**: `teamind init` creates/joins an org, configures IDEs, seeds brain, prints invite code — all in <3 minutes

**Independent Test**: Run `teamind init` on fresh machine with Claude Code → org created, IDE configured, decisions seeded, invite code displayed. Join from second machine with invite code.

### Implementation for User Story 1

- [ ] T017 [US1] Implement IDE detection (check for ~/.claude/, .codex/ directories, return list with config paths) in packages/cli/src/ide/detect.ts
- [ ] T018 [P] [US1] Implement Claude Code MCP config writer (JSON merge into settings.json, stop hook config, cleanupPeriodDays: 99999) in packages/cli/src/ide/claude-code.ts
- [ ] T019 [P] [US1] Implement Codex MCP config writer (write to .codex/ mcp config) in packages/cli/src/ide/codex.ts
- [ ] T020 [P] [US1] Implement CLAUDE.md/AGENTS.md marker injection (create if missing, append between <!-- teamind:start/end --> markers, idempotent, never modify parent-level) in packages/cli/src/ide/claude-code.ts (extend)
- [ ] T021 [P] [US1] Implement seed parser: extract decisions from CLAUDE.md in packages/cli/src/seed/parse-claude-md.ts (reference: docs/validation/seed-claude-md.js)
- [ ] T022 [P] [US1] Implement seed parser: extract decisions from AGENTS.md in packages/cli/src/seed/parse-agents-md.ts
- [ ] T023 [P] [US1] Implement seed parser: extract decisions from git log (recent meaningful commits) in packages/cli/src/seed/parse-git-log.ts (reference: docs/validation/seed-git-log.js)
- [ ] T024 [US1] Implement seed orchestrator (run all parsers, batch store to Supabase + Qdrant, report count) in packages/cli/src/seed/index.ts
- [ ] T025 [US1] Implement init command (interactive prompts, create/join org via Edge Functions, save config, detect IDEs, configure MCP + --dangerously-load-development-channels flag, inject markers, run seed, verify round-trip, print invite code) in packages/cli/src/commands/init.ts
- [ ] T026 [US1] Implement CLI entry point with commander (register init + version + help) in packages/cli/bin/teamind.ts

**Checkpoint**: `teamind init` works end-to-end. Org created, IDEs configured, decisions seeded.

---

## Phase 4: User Story 2 — Decision Capture (Priority: P2)

**Goal**: Decisions auto-captured through channel reminders, keyword triggers, and startup sweep. `teamind_store` MCP tool works.

**Independent Test**: Start `teamind serve`, make decisions during coding session, verify decisions captured without manual action.

### Implementation for User Story 2

- [ ] T027 [US2] Implement MCP server setup with stdio transport, channel capability registration, and 3 tool definitions in packages/cli/src/mcp/server.ts (reference: docs/validation/mcp-prototype.js, contracts/channel-events.md § Implementation Constraints)
- [ ] T028 [US2] Implement teamind_store handler (validate → secret check → dedup → dual write Supabase + Qdrant → offline fallback → return response) in packages/cli/src/mcp/tools/store.ts per mcp-tools contract
- [ ] T029 [US2] Implement JSONL activity watcher (chokidar watch ~/.claude/projects/**/*.jsonl, track byte offset per file in watcher-state.json, detect activity, push channel capture reminder) in packages/cli/src/capture/watcher.ts
- [ ] T030 [P] [US2] Implement stop hook HTTP handler (localhost random port, POST /hook/stop receives session end event, push channel capture reminder, save port to ~/.teamind/hook-port) in packages/cli/src/capture/hook-handler.ts
- [ ] T031 [US2] Implement startup sweep (scan ~/.claude/projects/ for unprocessed JSONL since last timestamp, extract and store raw decisions as type:pending, flush offline queue) in packages/cli/src/capture/startup-sweep.ts
- [ ] T032 [US2] Implement serve command (load config → startup sweep async → start watcher → start hook handler → start MCP server blocking → on exit save state) in packages/cli/src/commands/serve.ts
- [ ] T033 [US2] Register serve command in CLI entry point in packages/cli/bin/teamind.ts (extend)

**Checkpoint**: `teamind serve` runs all 3 capture layers + MCP store tool. Auto-capture works.

---

## Phase 5: User Story 3 — Decision Search & Context (Priority: P3)

**Goal**: Agents search team brain via MCP tools. Eng Manager searches from CLI.

**Independent Test**: Store "We chose PostgreSQL" via Dev A. Dev B's agent calls `teamind_search({query: "database"})` → finds it.

### Implementation for User Story 3

- [ ] T034 [US3] Implement teamind_search handler (validate → Qdrant hybrid search with org_id filter + optional type filter → return ranked results → offline: empty results) in packages/cli/src/mcp/tools/search.ts per mcp-tools contract
- [ ] T035 [US3] Implement teamind_context handler (build query from task_description + files → Qdrant search → group by type → first-call orientation note → offline: empty) in packages/cli/src/mcp/tools/context.ts per mcp-tools contract
- [ ] T036 [US3] Implement CLI search command (teamind search <query> --type --limit, call Qdrant directly, format colored table output) in packages/cli/src/commands/search-cmd.ts
- [ ] T037 [US3] Register search command in CLI entry point in packages/cli/bin/teamind.ts (extend)

**Checkpoint**: MCP search + context tools work. CLI search works.

---

## Phase 6: User Story 4 — Real-Time Team Awareness (Priority: P4)

**Goal**: When Dev A stores a decision, Dev B's active session gets a push notification via channel.

**Independent Test**: Dev A stores decision. Dev B's session receives channel notification without searching.

### Implementation for User Story 4

- [ ] T038 [US4] Implement channel push emitter (emit notifications/claude/channel with new_decision event containing author, type, summary) in packages/cli/src/channel/push.ts per channel-events contract
- [ ] T039 [US4] Integrate channel push into teamind_store pipeline (after successful dual write, push to local channel; cross-session push scoped for later) in packages/cli/src/mcp/tools/store.ts (extend)

**Checkpoint**: Store → channel push works for local session. Cross-session push deferred.

---

## Phase 7: User Story 5 — Security (Priority: P5)

**Goal**: Secret detection blocks all 10 patterns. Tenant isolation enforced at every layer.

**Independent Test**: Store text with API key → blocked. Two orgs → cross-org search returns 0.

### Implementation for User Story 5

- [ ] T040 [US5] Add comprehensive test data for all 10 secret patterns (real examples, false negatives, false positives) and verify blocking across MCP store path in packages/cli/test/security/secrets.test.ts
- [ ] T041 [US5] Verify Supabase RLS policies enforce tenant isolation (org_id filter on decisions, members queries) and add RLS integration smoke test in packages/cli/test/cloud/supabase.test.ts

**Checkpoint**: All 10 secret patterns blocked. Cross-org queries return empty.

---

## Phase 8: User Story 6 — CLI Management (Priority: P6)

**Goal**: status, dashboard, export, config commands work from terminal.

**Independent Test**: `teamind status` shows health. `teamind dashboard` shows stats. `teamind export --json` produces valid file.

### Implementation for User Story 6

- [ ] T042 [US6] Implement status command (healthCheck both backends, show org name, decision count, pending queue, configured IDEs, color-coded output) in packages/cli/src/commands/status.ts per cli-commands contract
- [ ] T043 [P] [US6] Implement dashboard command (call getDashboardStats from Supabase, format colored table: totals by type/author, recent 5, pending count) in packages/cli/src/commands/dashboard.ts per cli-commands contract
- [ ] T044 [P] [US6] Implement export command (--json: fetch all decisions → write JSON, --markdown: group by type → write MD, --output flag or stdout) in packages/cli/src/commands/export-cmd.ts per cli-commands contract
- [ ] T045 [P] [US6] Implement config command (set/get for api-key with masking, author-name, org-id read-only) in packages/cli/src/commands/config-cmd.ts per cli-commands contract
- [ ] T046 [US6] Register status, dashboard, export, config commands in CLI entry point in packages/cli/bin/teamind.ts (extend)

**Checkpoint**: All management commands work from terminal.

---

## Phase 9: User Story 7 — Offline Resilience (Priority: P7)

**Goal**: Store queues locally offline, search returns empty, queue flushes on reconnect.

**Independent Test**: Disconnect → store → verify queued. Reconnect → verify synced. Search offline → empty results.

### Implementation for User Story 7

- [ ] T047 [US7] Integrate offline queue flush into serve startup and periodic check (attempt flush on every successful cloud connection, update pending count) in packages/cli/src/capture/startup-sweep.ts (extend)
- [ ] T048 [US7] Add partial failure handling for dual write (Postgres succeeds/Qdrant fails → retry Qdrant, Qdrant succeeds/Postgres fails → retry Postgres) in packages/cli/src/mcp/tools/store.ts (extend)

**Checkpoint**: Offline store/search works. Queue flushes. Partial failures handled.

---

## Phase 10: User Story 8 — Clean Uninstall & Error Messages (Priority: P8)

**Goal**: `teamind uninstall` cleanly removes all artifacts. All errors include what/why/how-to-fix.

**Independent Test**: Install → uninstall → verify no artifacts remain. Trigger each error → verify message format.

### Implementation for User Story 8

- [ ] T049 [US8] Implement uninstall command (read manifest, remove MCP configs from IDEs via surgical JSON edit, remove CLAUDE.md markers, remove hook configs, delete ~/.teamind/, print cloud data warning) in packages/cli/src/commands/uninstall.ts per cli-commands contract
- [ ] T050 [US8] Register uninstall command in CLI entry point in packages/cli/bin/teamind.ts (extend)
- [ ] T051 [US8] Verify all 7 error message constants produce actionable output (what happened, why, how to fix) across all command paths in packages/cli/src/errors.ts (review and extend if gaps)

**Checkpoint**: Uninstall removes all artifacts. Error messages are actionable.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation, documentation, publish

- [ ] T052 End-to-end flow test: init → serve → store → search → dashboard → export → uninstall (manual validation per quickstart.md)
- [ ] T053 [P] Write README.md (install, quickstart 30s, features, how it works, pricing link) at repo root
- [ ] T054 [P] Write AGENTS.md (Teamind instructions for AI agents — dogfooding) at repo root
- [ ] T055 Build and dry-run npm publish from packages/cli (verify package contents, bin entry, zero native deps)
- [ ] T056 Tag v0.1.0 and prepare for beta distribution

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — first MVP increment
- **US2 (Phase 4)**: Depends on Foundational + US1 (init creates org, serve needs config)
- **US3 (Phase 5)**: Depends on Foundational (needs Qdrant client). Can parallel with US2 for MCP tool work.
- **US4 (Phase 6)**: Depends on US2 (extends store pipeline)
- **US5 (Phase 7)**: Depends on Foundational (verification of security modules)
- **US6 (Phase 8)**: Depends on Foundational (needs cloud clients). Can parallel with US2/US3.
- **US7 (Phase 9)**: Depends on US2 (extends store and startup sweep)
- **US8 (Phase 10)**: Depends on US1 (uninstall reverses init)
- **Polish (Phase 11)**: Depends on all stories complete

### User Story Dependencies

```
Foundational ──┬── US1 (init) ──┬── US2 (capture) ── US4 (push)
               │                │                 └── US7 (offline)
               │                └── US8 (uninstall)
               ├── US3 (search) ─── can parallel with US2
               ├── US5 (security verification)
               └── US6 (CLI management) ─── can parallel with US2/US3
```

### Parallel Opportunities

Within Phase 2 (Foundational):
- T005, T006, T007 can run in parallel (errors, config, manifest)
- T009, T010 can run in parallel (2 Edge Functions)
- T013, T014, T015, T016 can run in parallel (Qdrant client, secrets, queue, dedup)

Within US1:
- T018, T019 in parallel (Claude Code + Codex config)
- T021, T022, T023 in parallel (3 seed parsers)

Within US6:
- T042, T043, T044, T045 mostly parallel (4 CLI commands, different files)

---

## Parallel Example: Foundational Phase

```bash
# Batch 1: Types first (others depend on it)
Task T004: "Shared types in packages/cli/src/types.ts"

# Batch 2: Independent modules (all depend on types)
Task T005: "Error constants in packages/cli/src/errors.ts"
Task T006: "Config store in packages/cli/src/config/store.ts"
Task T007: "Manifest tracker in packages/cli/src/config/manifest.ts"
Task T014: "Secret detection in packages/cli/src/security/secrets.ts"
Task T015: "Offline queue in packages/cli/src/offline/queue.ts"
Task T016: "Content dedup in packages/cli/src/capture/dedup.ts"

# Batch 3: Schema + Edge Functions (independent of CLI code)
Task T008: "Postgres schema in supabase/migrations/001_init.sql"
Task T009: "Edge Function create-org"
Task T010: "Edge Function join-org"
Task T011: "Edge Function rotate-key"

# Batch 4: Cloud clients (depend on types + schema)
Task T012: "Supabase client in packages/cli/src/cloud/supabase.ts"
Task T013: "Qdrant client in packages/cli/src/cloud/qdrant.ts"
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 — Organization Setup
4. **STOP and VALIDATE**: `teamind init` works, org created, IDEs configured
5. This alone delivers: shared org, seeded brain, configured IDEs

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 (init) → Team can create orgs and seed (MVP!)
3. US2 (capture) → Decisions captured automatically
4. US3 (search) → Decisions retrievable
5. US4 (push) → Real-time team awareness
6. US5 (security) → Verified secure
7. US6 (management) → Full CLI suite
8. US7 (offline) → Resilient
9. US8 (uninstall) → Reversible
10. Polish → Ready for beta

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to spec.md user story for traceability
- Each user story phase is independently testable at its checkpoint
- Commit after each task or logical group
- Stop at any checkpoint to validate — each phase adds value
- All file paths reference plan.md project structure

## Analysis Findings (2026-03-22)

Resolved before implementation:
- **FR-016 (was HIGH)**: Downgraded MUST → SHOULD. MVP = local session
  push only. Cross-session broadcast (Dev A → Dev B) via Supabase
  Realtime is Phase 2.
- **T011 rotate-key (was MEDIUM)**: Removed from MVP. Contract preserved
  in contracts/edge-functions.md for Phase 2.

Address during implementation:
- **T003 [P] marker (LOW)**: T003 modifies packages/cli/package.json
  created by T002 — run T003 after T002, not in parallel.
- **RateLimit entity (LOW)**: Defined in data-model.md but not in
  spec.md Key Entities. Treat data-model.md as authoritative for
  entities.
- **CLAUDE.md injection content (LOW)**: Exact text between
  `<!-- teamind:start/end -->` markers not specified in contracts.
  Define during T020 implementation — derive from MCP tool descriptions
  and design-spec-v5 § CLAUDE.md instructions.

Docs/ coverage (added 2026-03-22):
- **contracts/channel-events.md**: Added Implementation Constraints
  section with channel research details (meta key format, console.error
  requirement, --dangerously-load-development-channels flag, Enterprise
  channelsEnabled setting, bug #36800, auth requirement).
- **T021, T023**: Added prototype references (docs/validation/seed-*.js)
- **T025**: Added --dangerously-load-development-channels flag to init
- **T027**: Added MCP prototype + channel constraints references
- **docs/validation/extraction-prompt.md**: NOT needed for MVP — Haiku
  enrichment removed in v5. Startup sweep stores raw text as pending.
