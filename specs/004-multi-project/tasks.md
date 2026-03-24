# Tasks: Multi-Project Support

**Input**: Design documents from `/specs/004-multi-project/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/edge-functions.md, contracts/config.md

**Tests**: Test tasks included per phase (unit + integration).

**Organization**: Tasks grouped by phase (9 phases). 6 user stories (P1-P6), independently testable.

## Format: `[ID] [P?] [USX?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[USX]**: Which user story (US1-US6)
- Paths relative to repo root

## Path Conventions

- **CLI package**: `packages/cli/src/`, `packages/cli/test/`
- **Supabase**: `supabase/migrations/`, `supabase/functions/`
- **Root**: `package.json`, `tsconfig.base.json`

---

## Phase 1: Setup

**Purpose**: Migration 004, extended types, new entities scaffolded

- [ ] T001 Extend types (new: Project interface with id/org_id/name/invite_code/created_at; new: ProjectMember interface with id/project_id/member_id/role/joined_at; new: ProjectConfig interface with project_id/project_name; new: ResolvedConfig interface with global/project; extend Decision: project_id becomes required UUID string (not nullable); add project_role to JWT claims type) in packages/cli/src/types.ts
- [ ] T002 Create Postgres migration 004_multi_project.sql: CREATE projects table (id UUID PK, org_id UUID FK, name TEXT, invite_code TEXT UNIQUE, created_at TIMESTAMPTZ), CREATE project_members table (id UUID PK, project_id UUID FK, member_id UUID FK, role TEXT CHECK, joined_at TIMESTAMPTZ), three-step decisions.project_id migration (add project_id_new UUID FK, backfill via default project, drop old TEXT, rename, NOT NULL), add project_id UUID to contradictions (backfill from decision_a_id, NOT NULL), add project_id UUID nullable to audit_entries, add project_id UUID nullable to rate_limits, create default project per org, create project_members for all existing members, add indexes (idx_decisions_project_id, idx_decisions_project_hash UNIQUE, idx_contradictions_project_status, idx_audit_entries_project_created), update audit_entries action CHECK for project_created/project_member_added/project_member_removed/migration_default_project, create effective_project_id() function, create/update RLS policies (projects_org_read, project_members_read, decisions_project_isolation replacing decisions_org_isolation, contradictions_project_read replacing contradictions_org_read), create/update RPC functions (search_decisions with p_project_id, get_dashboard_stats with p_project_id, find_contradictions with p_project_id, new list_member_projects), create migration audit entries per data-model.md in supabase/migrations/004_multi_project.sql
- [ ] T003 [P] Add error message constants (no_project_configured, project_not_found, no_project_access, wrong_project, project_name_exists, project_name_required, project_name_too_long, already_project_member, invalid_project_config) in packages/cli/src/errors.ts (extend)

---

## Phase 2: Foundational

**Purpose**: Config resolution, project CRUD in Supabase, project_id in JWT — blocks all user stories

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Implement per-directory project config module (findProjectConfig: walk-up from startDir to filesystem root looking for .teamind.json, first match wins; loadProjectConfig: read and validate with zod schema project_id UUID + project_name 1-100 chars; writeProjectConfig: write .teamind.json with project_id/project_name to target dir; resolveConfig: load global config + findProjectConfig, return ResolvedConfig) in packages/cli/src/config/project.ts (new file)
- [ ] T005 Extend config store (add loadProjectConfig import, extend loadConfig to call resolveConfig, export merged ResolvedConfig type, keep existing loadConfig/saveConfig backward compatible for global config) in packages/cli/src/config/store.ts (extend)
- [ ] T006 [P] Implement Edge Function create-project (Deno runtime, authenticate via Bearer token API key, verify member belongs to org, validate project_name 1-100 chars unique within org, check plan limits for max projects, generate XXXX-XXXX invite code, INSERT into projects, INSERT creator into project_members as project_admin, create audit entry project_created, return project metadata) in supabase/functions/create-project/index.ts (new file)
- [ ] T007 [P] Implement Edge Function join-project (Deno runtime, look up project by invite_code case-insensitive, resolve org from project.org_id, check org member limit for plan, if author exists in org skip member creation else create with per-member API key, check if already project member return 409, INSERT into project_members as project_member, create audit entries member_joined + project_member_added, return org + project metadata + credentials) in supabase/functions/join-project/index.ts (new file)
- [ ] T008 Extend Edge Function exchange-token (accept optional project_id in request body, if provided: verify project exists in member's org, verify member in project_members OR member.role='admin', return 403 no_project_access if no access, resolve project_role from project_members.role, add project_id + project_role claims to JWT, return project_id/project_name/project_role in response; if project_id omitted: mint org-level JWT without project_id claim for cross-project search) in supabase/functions/exchange-token/index.ts (extend)
- [ ] T009 Extend JWT client (exchangeToken: pass project_id from resolved config, cache JWTs per-project keyed by project_id, refreshToken: refresh per-project, getToken: return cached for active project_id, add getOrgToken: exchange without project_id for cross-project search) in packages/cli/src/auth/jwt.ts (extend)
- [ ] T010 [P] Test per-directory config resolution (test findProjectConfig walk-up: finds .teamind.json in parent, stops at root, closest wins in nested; test loadProjectConfig: valid/invalid JSON, missing fields, UUID validation; test writeProjectConfig: writes correct JSON; test resolveConfig: all 4 states from config contract — ready/no-project/no-org/unconfigured) in packages/cli/test/config/project.test.ts (new file)

**Checkpoint**: Config resolution works, create-project and join-project Edge Functions deployed, exchange-token mints project-scoped JWTs

---

## Phase 3: US1 — Create Project in Init, Select Existing, Per-Directory Config

**Goal**: `teamind init` supports creating/selecting projects, `.teamind.json` written per directory

**Independent Test**: Run `teamind init` in two directories, create two different projects in the same org. Verify each directory has its own `.teamind.json`.

### Implementation for User Story 1

- [ ] T011 [US1] Extend init command: Case 1 fresh install — after org creation, prompt for project name (default: directory name), call create-project EF, write .teamind.json; Case 2 org exists, no .teamind.json — show "Org: X (already configured)", list existing projects via list_member_projects RPC with decision counts, allow select existing or create new, call create-project if new, write .teamind.json; Case 3 init --join <invite-code> — call join-project EF instead of join-org, save global config if missing, write .teamind.json with returned project_id/name; Case 4 reconfigure (both configs exist) — show current org+project, options: switch project / reconfigure org / cancel in packages/cli/src/commands/init.ts (extend)
- [ ] T012 [US1] Extend Supabase client: add listMemberProjects RPC call (p_member_id), add createProject method (calls create-project EF via fetch), add joinProject method (calls join-project EF via fetch) in packages/cli/src/cloud/supabase.ts (extend)
- [ ] T013 [P] [US1] Test init command project flow (test Case 2: org exists shows project list; test Case 3: --join writes .teamind.json; test fresh init creates project + writes .teamind.json; verify global config unchanged when only project changes) in packages/cli/test/commands/init.test.ts (extend or new)

**Checkpoint**: `teamind init` creates projects, writes `.teamind.json`. Two directories can point to different projects in the same org.

---

## Phase 4: US2 — Per-Project Member Access, Project-Scoped Invites, RBAC

**Goal**: Members are granted access per-project. Project invite codes. RBAC enforced.

**Independent Test**: Add member to project A only. They can store/search in A. They get 403 when accessing project B.

### Implementation for User Story 2

- [ ] T014 [US2] Extend RBAC module (add project-level permission checks: canAccessProject checks project_members or org admin, canManageProjectMembers checks project_admin or org admin, canRotateProjectInvite checks project_admin or org admin; add project_role resolution from JWT claims) in packages/cli/src/auth/rbac.ts (extend)
- [ ] T015 [US2] Extend Edge Function change-status (extract project_id from JWT claims, verify decision belongs to JWT's project_id else return 403 wrong_project, use project_role for permission checks: project_member can deprecate/promote, project_admin or org admin can supersede, include project_id in audit entry) in supabase/functions/change-status/index.ts (extend)
- [ ] T016 [US2] Extend Edge Function rotate-key (add new rotation target "project_invite_code", accept project_id in request, verify caller is project_admin or org admin, generate new invite code, UPDATE projects.invite_code, create audit entry with project_id) in supabase/functions/rotate-key/index.ts (extend)
- [ ] T017 [P] [US2] Validate project access on all Edge Functions: change-status validates project_id from JWT (T015), check-usage adds project_id tracking to rate_limits, exchange-token validates project access (T008 already done), create-project validates org membership (T006 already done), join-project validates invite code (T007 already done) — verify complete coverage in supabase/functions/check-usage/index.ts (extend)
- [ ] T018 [P] [US2] Test RBAC project permissions (test canAccessProject: member with access passes, member without access fails, org admin passes for any project; test wrong_project rejection from change-status; test project_invite_code rotation requires project_admin) in packages/cli/test/auth/rbac.test.ts (extend or new)

**Checkpoint**: Per-project access enforced via JWT project_id. Project invite codes work. RBAC validates project roles.

---

## Phase 5: US3 — Project-Scoped Search/Context, --all-projects Flag

**Goal**: Search and context filter by active project. Cross-project search via --all-projects.

**Independent Test**: Store "Use NextAuth" in project A, "Use JWT" in project B. Search "auth" from A — only NextAuth. Search --all-projects — both appear.

### Implementation for User Story 3

- [ ] T019 [US3] Extend Qdrant client (upsertDecision: include project_id in payload, createPayloadIndex for project_id keyword field on ensureCollection; searchDecisions: add project_id to must filter clause alongside org_id; add searchDecisionsAllProjects: accept array of project_ids, use should clause for project_id matching; handle legacy points without project_id via should fallback filter during migration) in packages/cli/src/cloud/qdrant.ts (extend)
- [ ] T020 [US3] Extend Supabase client queries (all decision queries add project_id parameter: searchDecisions, getDashboardStats, findContradictionCandidates; add cross-project query variant that omits project_id filter and uses org-level JWT) in packages/cli/src/cloud/supabase.ts (extend)
- [ ] T021 [US3] Extend teamind_search MCP tool (resolve project from config, pass project_id to Qdrant + Supabase search; add all_projects boolean parameter, when true: get member's project list via list_member_projects, exchange org-level JWT, search across all accessible projects via Qdrant should clause, label results with [project-name] prefix; respect access control — only search projects member has access to) in packages/cli/src/mcp/tools/search.ts (extend)
- [ ] T022 [US3] Extend teamind_context MCP tool (resolve project from config, pass project_id to all context queries, filter decisions to active project only by default; add all_projects parameter for cross-project context loading) in packages/cli/src/mcp/tools/context.ts (extend)
- [ ] T023 [US3] Extend teamind_store MCP tool (resolve project from config, include project_id in all store calls to both Supabase and Qdrant, reject store if no project configured with clear error message) in packages/cli/src/mcp/tools/store.ts (extend)
- [ ] T024 [US3] Extend MCP server (resolve project config before tool dispatch using resolveConfig, pass project_id to all tool handlers, handle missing project gracefully with error message) in packages/cli/src/mcp/server.ts (extend)
- [ ] T025 [US3] Extend CLI search command (add --all-projects flag, when set pass all_projects=true to search handler, format output with [project-name] prefix for cross-project results) in packages/cli/src/commands/search-cmd.ts (extend)
- [ ] T026 [P] [US3] Extend contradiction detection (pass project_id to findContradictionCandidates and detectContradictions, contradictions are scoped within a single project — cross-project contradictions are not possible by design) in packages/cli/src/contradiction/detect.ts (extend)
- [ ] T027 [P] [US3] Extend dashboard command (scope all stats to active project_id from resolved config: decision counts, type distribution, contradiction counts, pattern counts — all filtered by project_id via updated RPC functions) in packages/cli/src/commands/dashboard.ts (extend)
- [ ] T028 [P] [US3] Test project-scoped search (test search with project_id returns only project decisions; test all_projects returns from multiple projects; test access control in cross-project mode; test Qdrant project_id filter; test store includes project_id in both Supabase and Qdrant) in packages/cli/test/mcp/search.test.ts (extend) and packages/cli/test/cloud/qdrant.test.ts (extend)

**Checkpoint**: Search/context/store all project-scoped. --all-projects cross-project search works with access control. Dashboard project-scoped.

---

## Phase 6: US4 — Project-Scoped Realtime Push

**Goal**: Push notifications scoped to project, not org. Dev on project B does not see project A notifications.

**Independent Test**: Two devs on project A, one on project B. Dev on A stores decision. Other dev on A gets push. Dev on B gets nothing.

### Implementation for User Story 4

- [ ] T029 [US4] Extend Realtime subscription client (change channel name from `org:${orgId}` to `project:${projectId}`, change filter from `org_id=eq.${orgId}` to `project_id=eq.${projectId}`, subscribe to active project channel, unsubscribe on project switch, handle missing project_id gracefully — fall back to org-level subscription during migration) in packages/cli/src/cloud/realtime.ts (extend)
- [ ] T030 [US4] Extend serve command (resolve project config before subscribing, subscribe to project-scoped Realtime channel using project_id from .teamind.json, log active project on startup, on project switch — unsubscribe from old channel, subscribe to new) in packages/cli/src/commands/serve.ts (extend)
- [ ] T031 [P] [US4] Extend channel push events (add project_id and project_name to remote decision events, add project_id to contradiction events, include project context in push notification formatting) in packages/cli/src/channel/push.ts (extend)
- [ ] T032 [P] [US4] Test project-scoped Realtime (test subscription uses project channel not org; test filter uses project_id; test unsubscribe on project switch; test fallback to org-level when no project_id) in packages/cli/test/cloud/realtime.test.ts (extend)

**Checkpoint**: `teamind serve` subscribes to project channel. Cross-session push is project-scoped. No cross-project notification leakage.

---

## Phase 7: US5 — Switch Between Projects

**Goal**: Auto-detection via per-directory config + manual `teamind switch --project` command

**Independent Test**: Init project A in /frontend, project B in /backend. `cd /frontend && teamind status` shows A. `cd /backend && teamind status` shows B.

### Implementation for User Story 5

- [ ] T033 [US5] Implement switch command (teamind switch --project <name-or-id>: load global config, list member's projects via list_member_projects RPC, find match by name or UUID, update .teamind.json in cwd, print confirmation; interactive mode with no flags: show project list, prompt for selection; handle no match with clear error) in packages/cli/src/commands/switch.ts (new file)
- [ ] T034 [US5] Extend status command (show active project from resolved .teamind.json: "Project: frontend-app (active)"; show "Project: (not configured)" when no .teamind.json found; show project-scoped decision count "Brain: N decisions in this project"; show Realtime subscription project name) in packages/cli/src/commands/status.ts (extend)
- [ ] T035 [US5] Register switch command in CLI entry point (add "switch" command with --project option to commander setup) in packages/cli/src/index.ts (extend)
- [ ] T036 [P] [US5] Test switch command (test switch by name updates .teamind.json; test switch by UUID; test interactive mode; test invalid project name error; test status shows correct project per directory) in packages/cli/test/commands/switch.test.ts (new file)

**Checkpoint**: `cd` between repos auto-switches project. `teamind switch` manual switch works. `teamind status` shows active project.

---

## Phase 8: US6 — Migration of Existing Decisions to Default Project

**Goal**: Existing decisions without project_id migrated to default project. Backward compatible.

**Independent Test**: Store decisions with old version (no project_id). Upgrade. Verify all decisions in "default" project. Search works.

### Implementation for User Story 6

- [ ] T037 [US6] Implement Qdrant background migration (iterate all Qdrant points missing project_id, look up project_id from Postgres decisions table, update Qdrant payload with project_id; can run as a one-time CLI command `teamind admin migrate-qdrant` or lazily on next upsert/search; handle legacy filter during transition: include points with matching project_id OR missing project_id field) in packages/cli/src/cloud/qdrant.ts (extend) or packages/cli/src/commands/admin-migrate-qdrant.ts (new file)
- [ ] T038 [US6] Extend init command migration path (when upgraded CLI detects global config but no .teamind.json: prompt user, look up default project in org via list_member_projects, if default project exists write .teamind.json pointing to it, if no default project exists call create-project to create one; commands that require project print "No project configured. Run teamind init." until .teamind.json exists) in packages/cli/src/commands/init.ts (extend)
- [ ] T039 [P] [US6] Test migration scenarios (test migration 004 SQL creates default projects per org; test all existing decisions get project_id after migration; test existing members become project_members of default project; test search still works after migration; test init detects legacy config and offers migration) in packages/cli/test/migration/default-project.test.ts (new file)

**Checkpoint**: Existing installations upgrade seamlessly. All pre-existing decisions in default project. Zero data loss. Search works as before.

---

## Phase 9: Polish

**Purpose**: E2E validation, docs, backward compatibility verification

- [ ] T040 End-to-end flow test: fresh init with project creation -> store decision in project A -> init project B in new directory -> store in B -> search from A (only A results) -> search --all-projects (both) -> switch project -> verify push scoped to project -> join-project via invite code -> verify RBAC (403 on wrong project) -> upgrade from legacy (no project_id) -> verify migration (manual validation per quickstart.md)
- [ ] T041 [P] Backward compatibility verification: run full existing test suite (255 tests) after migration 004 applied, verify no regressions, verify legacy clients without project_id in JWT still work via effective_project_id() IS NULL fallback in RLS policies
- [ ] T042 [P] Build and dry-run npm publish from packages/cli (verify new files included: config/project.ts, commands/switch.ts, new Edge Functions; verify no missing deps)
- [ ] T043 [P] Update CLAUDE.md with Phase 4 multi-project context (active technologies, project structure additions, new CLI commands)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (types + migration). BLOCKS all user stories.
- **US1 (Phase 3)**: Depends on Foundational. First user-facing increment.
- **US2 (Phase 4)**: Depends on Foundational + US1 partially (init creates projects that RBAC protects). Can start after T008 (exchange-token with project_id).
- **US3 (Phase 5)**: Depends on Foundational + US1 (init creates projects, .teamind.json exists). Core search/store scoping.
- **US4 (Phase 6)**: Depends on Foundational. Can parallel with US3 (different files: realtime.ts vs search.ts).
- **US5 (Phase 7)**: Depends on Foundational + US1 (needs .teamind.json to exist). Can parallel with US3/US4.
- **US6 (Phase 8)**: Depends on Phase 1 (migration 004) + Foundational. Can start after T002 + T004.
- **Polish (Phase 9)**: Depends on all user stories complete.

### Task Dependencies

```
T001 (types) ──┬── T002 (migration) ──── T037 (Qdrant migration)
               │                    ──── T039 (migration tests)
               ├── T003 (errors)
               ├── T004 (project config) ─── T005 (store extend)
               │                         ─── T010 (config tests)
               │                         ─── T011 (init extend)
               │                         ─── T024 (MCP server)
               ├── T006 (create-project EF) ─── T011 (init calls it)
               ├── T007 (join-project EF) ─── T011 (init --join)
               ├── T008 (exchange-token) ─── T009 (JWT client)
               │                         ─── T014 (RBAC)
               │                         ─── T015 (change-status)
               └── T009 (JWT client) ──── T019 (Qdrant extend)
                                     ──── T020 (Supabase queries)
                                     ──── T021 (search tool)
                                     ──── T029 (Realtime)

T011 (init) ──── T033 (switch command, needs project listing)
T019 (Qdrant) ── T021 (search, needs Qdrant project filter)
T020 (Supabase) ── T021 (search, needs Supabase project filter)
T021 (search) ── T025 (CLI search --all-projects)
T024 (MCP server) ── T021, T022, T023 (all tools need project resolution)
```

### User Story Dependencies

```
Foundational ──┬── US1 (init/project creation)
               │     └── US3 (search/store scoping, needs projects to exist)
               ├── US2 (RBAC, needs project_id in JWT)
               ├── US4 (Realtime scoping)
               ├── US5 (switch, needs .teamind.json)
               └── US6 (migration, needs default project + config)
```

### Parallel Opportunities

Within Phase 1:
- T003 can parallel with T001/T002 (error constants — different file)

Within Phase 2:
- T006, T007 can parallel (create-project, join-project — different Edge Functions)
- T010 can parallel with T006, T007 (config tests vs Edge Functions)

Within Phase 3:
- T013 can parallel with T012 (init tests vs Supabase client)

Within Phase 4:
- T017, T018 can parallel (check-usage extend vs RBAC tests)

Within Phase 5:
- T026, T027, T028 can parallel (contradiction, dashboard, tests — different files)

Within Phase 6:
- T031, T032 can parallel (push events, Realtime tests)

Within Phase 7:
- T036 can parallel with T033 (switch tests vs implementation — test-first)

Within Phase 8:
- T039 can parallel with T037 (migration tests vs Qdrant migration)

Cross-phase parallelism:
- US4 (T029-T032) can run in parallel with US3 (T019-T028) — different files
- US5 (T033-T036) can run in parallel with US4 — different files
- US6 (T037-T039) can start after Phase 2, parallel with US3-US5

---

## Implementation Strategy

### MVP First (US1 + US3 Core)

1. Complete Phase 1: Setup (types, migration, errors)
2. Complete Phase 2: Foundational (config, Edge Functions, JWT)
3. Complete Phase 3: US1 — Init creates projects, .teamind.json written
4. Complete Phase 5: US3 — Search/store/context project-scoped
5. **STOP and VALIDATE**: Projects created, decisions scoped, search filtered

### Incremental Delivery

1. Setup + Foundational -> Foundation ready
2. US1 (init/project creation) -> Projects exist, per-directory config works
3. US3 (search/store scoping) -> Decisions isolated per project
4. US2 (RBAC) -> Per-project access control enforced
5. US4 (Realtime) -> Push notifications project-scoped
6. US5 (switch) -> Frictionless project switching
7. US6 (migration) -> Backward compatible upgrade
8. Polish -> Ready for release

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [USX] label maps task to spec.md user story for traceability
- Each user story phase is independently testable at its checkpoint
- Commit after each task or logical group
- Stop at any checkpoint to validate — each phase adds value
- All file paths reference plan.md project structure
- Backward compatibility: pre-project installations MUST work after migration 004
- Edge Functions use Deno runtime with esm.sh imports (not Node.js)
- The default project migration (Phase 8) can run before US3-US5 if needed for testing
- Cross-project search uses org-level JWT (no project_id claim) with application-level filtering via project_members

<!--
## Analysis Report

### A. FR-to-Task Mapping

| FR | Description | Task IDs | Coverage |
|----|-------------|----------|----------|
| FR-001 | Multiple projects within org | T001, T002, T006, T011 | FULL — Project entity created in types, migration, Edge Function, and init |
| FR-002 | Every decision belongs to exactly one project via project_id | T001, T002, T019, T020, T023 | FULL — Type enforced, migration makes NOT NULL, store includes project_id |
| FR-003 | Members granted access to specific projects | T007, T014, T018 | FULL — join-project grants access, RBAC checks, tests verify |
| FR-004 | search/context filter by active project by default | T019, T020, T021, T022, T024, T028 | FULL — Qdrant filter, Supabase filter, MCP tools, server resolution, tests |
| FR-005 | Cross-project search via all_projects with access control | T021, T025, T028 | FULL — search tool, CLI flag, tests for access control |
| FR-006 | Push notifications scoped to active project | T029, T030, T031, T032 | FULL — Realtime channel, serve command, push events, tests |
| FR-007 | teamind init creates/selects project, stores in local config | T004, T011, T013 | FULL — config module, init command, tests |
| FR-008 | Invite codes project-scoped | T006, T007, T011, T016 | FULL — create-project generates code, join-project uses code, init uses it, rotate supports it |
| FR-009 | JWT includes project_id alongside org_id | T008, T009 | FULL — exchange-token extended, JWT client caches per-project |
| FR-010 | Realtime subscriptions filter by project_id | T029, T032 | FULL — Realtime client, tests |
| FR-011 | Existing decisions migrated to default project | T002, T037, T038, T039 | FULL — SQL migration, Qdrant migration, init migration path, tests |
| FR-012 | Per-directory config via .teamind.json | T004, T005, T010, T011 | FULL — project.ts module, store integration, tests, init writes it |
| FR-013 | RBAC: org admin / project admin / project member | T014, T015, T018 | FULL — RBAC module, change-status uses it, tests |
| FR-014 | All Edge Functions validate project_id from JWT | T008, T015, T016, T017 | FULL — exchange-token, change-status, rotate-key, check-usage |
| FR-015 | Dashboard/contradictions/patterns/cleanup project-scoped | T026, T027 | FULL — contradiction detection scoped, dashboard scoped |

**Gaps**: NONE. All 15 FRs have task coverage.

### B. Constitution Alignment

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Cloud-First | PASS | Projects/project_members in Supabase. Edge Functions for CRUD. No local-only project management. |
| II | Minimally Invasive | PASS | .teamind.json is passive, read on demand. No IDE interception. Same MCP channel integration. |
| III | Non-Blocking | PASS | Missing .teamind.json degrades to "no project" message (T034, T038). Realtime fallback to org-level (T029). |
| IV | No LLM Dependency | PASS | All operations deterministic. No LLM calls for project creation, membership, or filtering. |
| V | Zero Native Dependencies | PASS | No new deps. Config resolution uses Node.js built-in fs/path. |
| VI | Auto-Capture by Default | PASS | Auto-capture layers include project_id from resolved config (T023, T024). |
| VII | Dual Storage | PASS | Every write includes project_id in both Postgres (T020) and Qdrant (T019). |
| VIII | Push + Pull | PASS | Push scoped to project (T029-T031). Pull still works without push. |
| IX | Decision Lifecycle | PASS | Status transitions work within project scope (T015). Cross-project contradictions impossible by design (T026). |
| X | Identity-First Access | PASS | JWT includes project_id + project_role (T008). RLS enforces project isolation (T002). Audit trail includes project_id. |
| XI | Project-Scoped Isolation | PASS | This feature IS the implementation. Every FR maps to tasks. |

**Violations**: NONE. All 11 principles pass.

### C. Dependency Ordering Issues

| Issue | Severity | Resolution |
|-------|----------|------------|
| T009 (JWT client) depends on T008 (exchange-token) being deployed | LOW | T008 is in Phase 2, same phase as T009. Order within phase is T008 before T009. Already correct. |
| T021 (search tool) depends on both T019 (Qdrant) and T020 (Supabase) | LOW | All in Phase 5. T019 and T020 should complete before T021. Already correct. |
| T011 (init) depends on T006 (create-project) and T007 (join-project) being deployed | LOW | T006/T007 in Phase 2, T011 in Phase 3. Already correct. |
| T033 (switch) depends on T012 (listMemberProjects in Supabase client) | LOW | T012 in Phase 3, T033 in Phase 7. Already correct. |

**Critical ordering issues**: NONE.

### D. Ambiguity / Missing Coverage

| Item | Severity | Notes |
|------|----------|-------|
| Qdrant legacy filter during migration | LOW | T019 and T037 both address this. The "should" fallback filter for legacy points without project_id is specified in research.md and covered by T019. |
| join-org deprecation path | LOW | plan.md says join-org is deprecated but kept for backward compat. No task explicitly modifies join-org. This is correct — it remains as-is. |
| Project deletion | N/A | Out of scope per data-model.md "Projects are permanent once created." |
| Moving decisions between projects | N/A | Out of scope per research.md "future feature, not in scope." |
| check-usage per-project tracking | LOW | T017 extends check-usage to add project_id to rate_limits. Limits remain org-scoped per edge-functions contract. |
| admin-patterns and admin-cleanup project scoping | LOW | Not explicitly tasked but will work via updated RPC functions in T002 (migration updates search_decisions, find_contradictions). These commands call the same RPCs. If they need explicit project_id passthrough, it would be caught in T040 E2E test. |
| Enrichment/synthesis project scoping | LOW | Enrichment and synthesis modules call store/search which are project-scoped (T021-T023). No separate task needed — they inherit project scoping from the MCP tools they call. |

**HIGH issues**: NONE found.
**LOW issues**: 5 noted above, all acceptable and either already covered implicitly or explicitly out of scope.

### E. Summary

- 43 tasks across 9 phases
- All 15 FRs fully covered
- All 11 Constitution principles pass
- No dependency ordering issues
- No HIGH severity gaps
- 5 LOW severity notes documented above (all acceptable)
-->
