# Tasks: Registration API

**Input**: Design documents from `/specs/005-registration-api/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/edge-functions.md

**Tests**: Test tasks included per phase (unit + integration).

**Organization**: Tasks grouped by phase (6 phases). 4 user stories (P1-P4), independently testable.

## Format: `[ID] [P?] [USX?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[USX]**: Which user story (US1-US4)
- Paths relative to repo root

## Path Conventions

- **CLI package**: `packages/cli/src/`, `packages/cli/test/`
- **Supabase**: `supabase/migrations/`, `supabase/functions/`

---

## Phase 1: Setup

**Purpose**: Types, migration, shared infrastructure

- [ ] T001 [P] Add RegistrationResponse type (member_api_key, supabase_url, qdrant_url, org_id, org_name, project_id, project_name, invite_code) and JoinPublicResponse type (org_id, org_name, project_id, project_name, member_api_key, member_id, supabase_url, qdrant_url, member_count, decision_count, role) in packages/cli/src/types.ts
- [ ] T002 [P] Create Postgres migration 005_registration_api.sql: CREATE registration_rate_limits table (id UUID PK default gen_random_uuid(), ip_address TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL default now()), CREATE INDEX idx_registration_rate_limits_ip_time ON registration_rate_limits (ip_address, created_at DESC), ENABLE RLS with no policies (service_role only access) in supabase/migrations/005_registration_api.sql
- [ ] T003 [P] Add error message constants for registration: registration_service_unavailable, rate_limit_exceeded, org_name_taken, invalid_org_name, invalid_project_name, invalid_invite_code_join in packages/cli/src/errors.ts (extend)

**Checkpoint**: Types defined, migration ready, error constants available

---

## Phase 2: US1 — First-Time Hosted Setup (Priority: P1)

**Goal**: New users complete `teamind init` (Hosted) by calling a public registration API — no credentials needed

**Independent Test**: Fresh machine, no config. Run `teamind init` -> Hosted -> enter org name + project name + name -> org created, project created, IDE configured, brain seeded. No .hosted-env or env vars needed.

### Implementation for User Story 1

- [ ] T004 [US1] Implement Edge Function register (Deno runtime, validate org_name/project_name/author_name 1-100 chars alphanumeric+spaces+hyphens, extract client IP from x-forwarded-for or x-real-ip, rate limit check via registration_rate_limits count per IP per hour max 10, check org name uniqueness case-insensitive, generate org api_key tm_ prefix + org invite_code + member api_key tmm_ prefix + project invite_code, INSERT orgs + members + projects + project_members atomically with manual rollback on failure, INSERT audit entries org_created + member_joined + project_created, INSERT registration_rate_limits, read SUPABASE_URL + QDRANT_URL from Deno.env, return RegistrationResponse with member_api_key + public URLs + IDs, no service_role key in response) in supabase/functions/register/index.ts (new file)
- [ ] T005 [US1] Create registration API client module (register function: POST /functions/v1/register with org_name + project_name + author_name, parse response into RegistrationResponse, map HTTP errors to user-friendly messages: 409 -> org name taken, 429 -> rate limit, 400 -> validation, 500/network -> service unavailable) in packages/cli/src/cloud/registration.ts (new file)
- [ ] T006 [US1] Rewrite init.ts hosted mode path: replace resolveCredentials hosted branch to prompt for org_name + project_name + author_name only, call registration.register(), save config with member_api_key + supabase_url + qdrant_url (NO service_role_key, NO qdrant_api_key), write .teamind.json with project_id + project_name, proceed to IDE setup + Qdrant setup + seed using exchange-token flow with member_api_key, handle registration errors with user-friendly messages per spec edge cases in packages/cli/src/commands/init.ts (modify)
- [ ] T007 [P] [US1] Unit test for register Edge Function: test successful registration returns 201 with all fields, test rate limiting returns 429 after 10 registrations, test org name taken returns 409, test validation errors return 400, test rollback on partial failure in packages/cli/test/cloud/registration.test.ts (new file)

**Checkpoint**: `teamind init` Hosted mode works via registration API. No .hosted-env needed.

---

## Phase 3: US2 — Join Existing Project (Priority: P2)

**Goal**: `teamind init --join <code>` works on a fresh machine with no config, calling a public endpoint

**Independent Test**: Create org + project (US1). Get invite code. On different machine, `teamind init --join <code>` -> joined, configured.

### Implementation for User Story 2

- [ ] T008 [US2] Modify join-project Edge Function: add supabase_url (from Deno.env SUPABASE_URL) and qdrant_url (from Deno.env QDRANT_URL) to response body, add member_id to response body, rename member_key to member_api_key in response for consistency with register endpoint in supabase/functions/join-project/index.ts (modify)
- [ ] T009 [US2] Add joinPublic function to registration client module (POST /functions/v1/join-project with invite_code + author_name, parse response into JoinPublicResponse, map errors: 404 -> invalid invite code, 409 -> already member, 403 -> member limit) in packages/cli/src/cloud/registration.ts (extend)
- [ ] T010 [US2] Rewrite init.ts --join path for hosted mode: when no existing config, call registration.joinPublic() instead of joinProject() which requires service_role_key, save config with member_api_key + supabase_url + qdrant_url from response (NO service_role_key), write .teamind.json, proceed to IDE setup, handle errors with user-friendly messages in packages/cli/src/commands/init.ts (modify)
- [ ] T011 [P] [US2] Unit test for join-public flow: test successful join returns credentials + URLs, test invalid invite code error, test already member error, test CLI --join saves correct config without service_role_key in packages/cli/test/cloud/registration.test.ts (extend)

**Checkpoint**: `teamind init --join` works on fresh machines via public endpoint. No credentials needed.

---

## Phase 4: US3 — Community Mode Unchanged (Priority: P3)

**Goal**: Community mode users provide their own credentials. Registration API not involved.

**Independent Test**: `teamind init` -> Community -> enter credentials manually -> works exactly as before.

### Implementation for User Story 3

- [ ] T012 [US3] Verify community mode path in init.ts is unchanged: user prompted for Supabase URL + Service Role Key + Qdrant URL + Qdrant API Key, config saved with supabase_service_role_key, all subsequent operations use service_role_key (legacy path preserved), add explicit test that community init does NOT call registration API in packages/cli/src/commands/init.ts (verify, no changes expected)
- [ ] T013 [P] [US3] Integration test for community mode: test that init community path prompts for 4 credentials, test that saved config includes supabase_service_role_key, test that no registration API calls are made in packages/cli/test/commands/init.test.ts (extend)

**Checkpoint**: Community mode works identically to Phase 4. No regressions.

---

## Phase 5: US4 — Remove .hosted-env Dependency (Priority: P4)

**Goal**: Remove loadHostedEnv(), HOSTED_CREDENTIALS, parseEnvContent(), and all .hosted-env references

**Independent Test**: Delete ~/.teamind/.hosted-env, unset TEAMIND_HOSTED_* vars. `teamind init` Hosted mode works via registration API.

### Implementation for User Story 4

- [ ] T014 [US4] Remove from init.ts: HOSTED_CREDENTIALS constant (lines 35-40), parseEnvContent() function (lines 42-53), loadHostedEnv() function (lines 55-69), all TEAMIND_HOSTED_* env var references in resolveCredentials hosted branch, the error message directing users to create .hosted-env in packages/cli/src/commands/init.ts (modify)
- [ ] T015 [US4] Remove unused imports from init.ts: readFileSync and existsSync (if no longer needed after loadHostedEnv removal), fileURLToPath (if no longer needed), dirname import from path (if only used by loadHostedEnv) in packages/cli/src/commands/init.ts (modify)
- [ ] T016 [P] [US4] Verify no service_role key references in hosted code paths: grep codebase for HOSTED_CREDENTIALS, loadHostedEnv, .hosted-env, TEAMIND_HOSTED_ to confirm complete removal, add static assertion test in packages/cli/test/commands/init.test.ts (extend)

**Checkpoint**: No .hosted-env, no TEAMIND_HOSTED_* env vars, no service_role key on client for hosted mode.

---

## Phase 6: Polish

**Purpose**: Tests, backward compatibility, documentation

- [ ] T017 [P] End-to-end test for full hosted registration flow: init -> register -> save config -> status -> verify config has member_api_key and no service_role_key in packages/cli/test/commands/init.test.ts (extend)
- [ ] T018 [P] End-to-end test for full join flow: init --join -> joinPublic -> save config -> status -> verify config in packages/cli/test/commands/init.test.ts (extend)
- [ ] T019 Run full test suite (npm test && npm run lint) to verify all 387+ existing tests pass, no regressions from init.ts changes or type changes in packages/cli/ (verify)
- [ ] T020 Run quickstart.md validation: execute all 4 user story scenarios manually, verify all checklist items pass in specs/005-registration-api/quickstart.md (verify)

**Checkpoint**: All tests pass. All user stories validated. Feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — can start immediately
- **Phase 2 (US1)**: Depends on Phase 1 (types + migration)
- **Phase 3 (US2)**: Depends on Phase 1 (types); can run in parallel with Phase 2 for EF work but CLI changes depend on T006
- **Phase 4 (US3)**: Independent — verify only, can run after Phase 2
- **Phase 5 (US4)**: Depends on Phase 2 (T006 must be done before removing old code)
- **Phase 6 (Polish)**: Depends on all previous phases

### Within Each Phase

- Tasks marked [P] can run in parallel
- Edge Function tasks and CLI tasks can be developed in parallel
- Test tasks can run after their corresponding implementation tasks

### Parallel Opportunities

- T001, T002, T003 (Phase 1) — all parallel, different files
- T004 (EF) and T005 (client) — parallel, different repos
- T007, T011, T013 — test tasks parallel with each other
- T017, T018 — e2e tests parallel with each other

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: US1 (T004-T007)
3. **STOP and VALIDATE**: `teamind init` Hosted works via API
4. Deploy register Edge Function + migration

### Incremental Delivery

1. Phase 1 + Phase 2 -> Hosted registration works (MVP)
2. Phase 3 -> Join via invite code works
3. Phase 4 -> Community mode verified unchanged
4. Phase 5 -> Legacy .hosted-env code removed
5. Phase 6 -> Full test suite + validation

---

## Notes

- Total: 20 tasks (T001-T020)
- [P] tasks = different files, no dependencies
- [USX] label maps task to specific user story
- This is a small, focused feature — most complexity is in T004 (register EF) and T006 (init.ts rewrite)
- The register Edge Function is the critical path — deploy and test it first

<!--
## Analysis: FR-to-Task Mapping

| FR | Description | Task IDs | Coverage |
|----|-------------|----------|----------|
| FR-001 | Public Edge Function `/functions/v1/register` creates org + project + member atomically, no auth | T004 | FULL — register EF implements atomic creation |
| FR-002 | Response returns only member_api_key (tmm_), public supabase_url, public qdrant_url, org_id, project_id, invite_code. No service_role or admin keys. | T004, T005 | FULL — T004 shapes response, T005 parses it |
| FR-003 | CLI hosted mode uses registration API instead of .hosted-env / env vars | T006, T014, T015 | FULL — T006 rewrites hosted path, T014-T015 remove old code |
| FR-004 | CLI stores only per-member credentials locally. No service_role key on client. | T006, T010, T016 | FULL — T006 saves member_api_key only, T010 same for join, T016 verifies removal |
| FR-005 | Public join endpoint accepts invite code + author name, creates member, returns per-member credentials | T008, T009, T010 | FULL — T008 modifies join-project EF, T009 creates client, T010 rewrites CLI join path |
| FR-006 | Community mode unchanged — users provide own credentials including service_role key | T012, T013 | FULL — T012 verifies no changes, T013 tests community path |
| FR-007 | Registration endpoint rate limited: max 10 orgs per IP per hour | T002, T004, T007 | FULL — T002 creates rate_limits table, T004 implements check, T007 tests it |
| FR-008 | All subsequent CLI operations work with per-member API key only (no service_role on client) | T006, T010, T017, T018, T019 | FULL — T006/T010 save member_api_key config, T017-T019 verify operations work |

## Constitution Compliance

| # | Principle | Status | Relevant Tasks |
|---|-----------|--------|----------------|
| I | Cloud-First | PASS | T004 (cloud registration), T008 (cloud join) |
| II | Minimally Invasive | PASS | No IDE changes — init prompts simplified |
| III | Non-Blocking | PASS | T006 (error handling with fallback messages) |
| IV | No LLM Dependency | PASS | No LLM calls anywhere |
| V | Zero Native Dependencies | PASS | No new deps (T001 types only) |
| VI | Auto-Capture by Default | PASS | Unchanged — works with member_api_key |
| VII | Dual Storage | PASS | Qdrant setup unchanged in init |
| VIII | Push + Pull | PASS | Realtime unchanged — JWT from exchange-token |
| IX | Decision Lifecycle | PASS | Unchanged — lifecycle uses JWT |
| X | Identity-First Access | IMPROVES | T004 issues per-member keys, T014 removes service_role from client |
| XI | Project-Scoped Isolation | PASS | T004 creates project, T010 joins project |

## Gap Analysis

- **No gaps identified.** All 8 FRs are covered by at least one task.
- **All 11 constitution principles pass.** Principle X improves (service_role key removed from clients).
- **All 4 user stories have dedicated phases** with independent tests.
- **Success criteria coverage**:
  - SC-001 (init in <60s): T006 + T020 (quickstart validation)
  - SC-002 (zero service_role on client): T014 + T016
  - SC-003 (register <2s): T004 (server-side) + T020 (manual validation)
  - SC-004 (community unchanged): T012 + T013
  - SC-005 (387 tests pass): T019
-->
