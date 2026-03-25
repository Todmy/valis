# Tasks: Vercel API Migration

**Input**: Design documents from `/specs/006-vercel-api-migration/`
**Prerequisites**: plan.md, spec.md, research.md, contracts/api-routes.md

**Tests**: Test tasks included per phase (unit + contract + integration).

**Organization**: Tasks grouped by phase (6 phases). 5 user stories (P1-P5), independently testable.

## Format: `[ID] [P?] [USX?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[USX]**: Which user story (US1-US5)
- Paths relative to repo root

## Path Conventions

- **Web package**: `packages/web/src/`, `packages/web/`
- **CLI package**: `packages/cli/src/`, `packages/cli/test/`
- **Supabase**: `supabase/functions/`

---

## Phase 1: Setup

**Purpose**: Shared infrastructure, dependencies, constants, utility modules

- [ ] T001 [P] [US1] Add `stripe` and `jose` as dependencies in packages/web/package.json. Run `pnpm install` from workspace root. Verify both resolve correctly.

- [ ] T002 [P] [US1] Add CORS headers for `/api/*` routes in packages/web/next.config.ts: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type, stripe-signature`. Use the `headers()` async function in the Next.js config.

- [ ] T003 [P] [US1] Create shared Supabase server client utility in packages/web/src/lib/supabase-server.ts: export `createServerClient()` that returns `createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)`. Import `createClient` from `@supabase/supabase-js`.

- [ ] T004 [P] [US1] Create shared API response helpers in packages/web/src/lib/api-response.ts: export `jsonResponse(body, status)` using `NextResponse.json()`, `unauthorized()` (401), `forbidden(msg)` (403), `badRequest(msg)` (400), `notFound(msg)` (404), `serverError(msg)` (500). All return `NextResponse` with JSON body `{ error: "..." }`.

- [ ] T005 [P] [US1] Create shared API auth helpers in packages/web/src/lib/api-auth.ts: export `extractBearerToken(request: NextRequest): string | null` (extracts and validates Bearer token from Authorization header, returns null if missing/malformed), `authenticateApiKey(supabase, apiKey): Promise<AuthResult | null>` (resolves tmm_ or tm_ key to member/org, returns { memberId, orgId, role, authorName } or null), `decodeJwtPayload(token: string): Record<string, unknown>` (base64-decode JWT payload without verification), `timingSafeEqual(a: string, b: string): boolean` (uses `node:crypto` `timingSafeEqual` with Buffer).

- [ ] T006 [P] [US1] Create shared key generators in packages/web/src/lib/api-keys.ts: export `generateOrgApiKey(): string` (returns `tm_` + 32 hex chars using `crypto.getRandomValues`), `generateMemberKey(): string` (returns `tmm_` + 32 hex chars), `generateInviteCode(): string` (returns `XXXX-XXXX` format using charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).

- [ ] T007 [P] [US2] Add `HOSTED_API_URL` constant to packages/cli/src/types.ts: `export const HOSTED_API_URL = 'https://teamind.krukit.co';`. Place it near the existing `HOSTED_SUPABASE_URL` and `HOSTED_QDRANT_URL` constants.

- [ ] T008 [P] [US2] Create URL resolution helper in packages/cli/src/cloud/api-url.ts (new file): export `resolveApiUrl(supabaseUrl: string, isHosted: boolean): string` that returns `HOSTED_API_URL` for hosted mode or `supabaseUrl` for community mode. Export `resolveApiPath(apiUrl: string, functionName: string): string` that returns `${apiUrl}/api/${functionName}` when apiUrl equals HOSTED_API_URL, or `${apiUrl}/functions/v1/${functionName}` for community mode. Export `isHostedMode(config: TeamindConfig): boolean` that returns true when `supabase_url === HOSTED_SUPABASE_URL` and `(!config.supabase_service_role_key || config.supabase_service_role_key === '')`.

**Checkpoint**: Shared utilities ready. Dependencies installed. Constants defined. URL resolver created.

---

## Phase 2: US1 — Migrate 13 Edge Functions to API Routes

**Goal**: All 13 Supabase Deno EFs rewritten as Next.js API routes with identical contracts

**Independent Test**: Deploy to Vercel. `curl` each route with the same inputs as the EF. Verify identical responses.

### Registration & Onboarding Routes (public, no auth)

- [ ] T009 [US1] Migrate register EF to packages/web/src/app/api/register/route.ts: export `POST(request: NextRequest)`. Translate Deno serve() to Next.js export. Replace `Deno.env.get` with `process.env`. Replace esm.sh createClient with npm import. Use shared utilities from T003-T006 (createServerClient, api-keys, api-response). Preserve rate limiting logic (registration_rate_limits table, 10/IP/hour). Preserve atomic creation (org + member + project + project_member with manual rollback). Preserve name validation (NAME_RE regex). Preserve all response shapes per contracts/api-routes.md. Extract client IP from `x-forwarded-for` or `x-real-ip` headers.

- [ ] T010 [P] [US1] Migrate join-project EF to packages/web/src/app/api/join-project/route.ts: export `POST(request: NextRequest)`. Replace Deno patterns with Node.js equivalents. Use shared utilities. Preserve invite code lookup, member creation, project_member insertion, member limit check. Preserve response shape including supabase_url, qdrant_url, member_count, decision_count.

- [ ] T011 [P] [US1] Migrate join-org EF to packages/web/src/app/api/join-org/route.ts: export `POST(request: NextRequest)`. Replace Deno patterns. Use shared utilities. Preserve org lookup by invite code, member creation with tmm_ key, member limit check per plan.

- [ ] T012 [P] [US1] Migrate create-org EF to packages/web/src/app/api/create-org/route.ts: export `POST(request: NextRequest)`. Replace Deno patterns. Use shared generateOrgApiKey, generateMemberKey, generateInviteCode from api-keys.ts. Preserve org + admin member insertion.

### Auth & Token Route (high-frequency, security-critical)

- [ ] T013 [US1] Migrate exchange-token EF to packages/web/src/app/api/exchange-token/route.ts: export `POST(request: NextRequest)`. Replace `import { SignJWT } from "https://deno.land/x/jose@v5.2.0/index.ts"` with `import { SignJWT } from 'jose'`. Replace `Deno.env.get("JWT_SECRET")` with `process.env.JWT_SECRET`. Replace `crypto.subtle.timingSafeEqual` with `timingSafeEqual` from shared api-auth.ts. Preserve key type detection (tmm_ vs tm_), member/org lookup, project-scoped JWT claims (org_id, member_id, role, project_id, project_role), 1-hour token lifetime. This is the most security-critical route — verify JWT output is identical to EF output.

### Billing & Usage Routes

- [ ] T014 [P] [US1] Migrate check-usage EF to packages/web/src/app/api/check-usage/route.ts: export `POST(request: NextRequest)`. Replace Deno patterns. Preserve PLAN_LIMITS constants, OVERAGE_RATES, JWT decoding for org_id extraction, rate_limits table query, plan lookup from orgs table. Preserve allowed/denied/overage response shapes.

- [ ] T015 [P] [US1] Migrate create-checkout EF to packages/web/src/app/api/create-checkout/route.ts: export `POST(request: NextRequest)`. Replace `import Stripe from "https://esm.sh/stripe@14"` with `import Stripe from 'stripe'`. Replace `Deno.env.get("STRIPE_SECRET_KEY")` with `process.env.STRIPE_SECRET_KEY`. Preserve price ID lookup from env vars, checkout session creation, org/member authentication.

- [ ] T016 [P] [US1] Migrate stripe-webhook EF to packages/web/src/app/api/stripe-webhook/route.ts: export `POST(request: NextRequest)`. Replace Stripe import from esm.sh with npm. Use `request.text()` for raw body (needed for signature verification). Replace `Deno.env.get("STRIPE_WEBHOOK_SECRET")` with `process.env.STRIPE_WEBHOOK_SECRET`. Preserve `stripe.webhooks.constructEvent()` signature verification. Preserve handling of checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed events. Add `export const dynamic = 'force-dynamic'` to disable body parsing.

### Admin & Lifecycle Routes (auth required)

- [ ] T017 [P] [US1] Migrate change-status EF to packages/web/src/app/api/change-status/route.ts: export `POST(request: NextRequest)`. Replace Deno patterns. Use shared api-auth.ts for bearer token extraction and API key authentication. Preserve VALID_TRANSITIONS map, AUDIT_ACTIONS map, status transition validation, audit log creation. Preserve JWT-based auth path (decodeJwtPayload for org_id/member_id extraction).

- [ ] T018 [P] [US1] Migrate rotate-key EF to packages/web/src/app/api/rotate-key/route.ts: export `POST(request: NextRequest)`. Replace Deno patterns. Use shared api-keys.ts for key generation. Preserve target validation (org/member/invite), admin-only check, old key invalidation, audit trail. Preserve all three rotation modes: org key, member key, invite code.

- [ ] T019 [P] [US1] Migrate revoke-member EF to packages/web/src/app/api/revoke-member/route.ts: export `POST(request: NextRequest)`. Replace Deno patterns. Preserve admin-only check, self-revocation prevention, last-admin prevention, revoked_at timestamp, audit trail.

### Data Routes

- [ ] T020 [P] [US1] Migrate seed EF to packages/web/src/app/api/seed/route.ts: export `POST(request: NextRequest)`. Replace Deno patterns. Preserve member authentication via API key, decision deduplication by content_hash, dual-write to Postgres + Qdrant (using QDRANT_URL and QDRANT_API_KEY from process.env). Preserve batch processing of decisions array.

### Route Tests

- [ ] T021 [P] [US1] Create contract tests for registration routes in packages/web/src/app/api/__tests__/register.test.ts: test register returns 201 with all required fields, test validation errors (400), test rate limiting (429), test org name conflict (409). Mock createServerClient.

- [ ] T022 [P] [US1] Create contract tests for exchange-token route in packages/web/src/app/api/__tests__/exchange-token.test.ts: test tmm_ key returns valid JWT with correct claims, test tm_ key returns valid JWT, test invalid key returns 401, test project-scoped JWT includes project_id and project_role claims. Verify JWT can be decoded and claims match.

- [ ] T023 [P] [US1] Create contract tests for billing routes in packages/web/src/app/api/__tests__/billing.test.ts: test check-usage allowed/denied/overage responses, test create-checkout returns checkout URL, test stripe-webhook processes events. Mock Stripe SDK.

- [ ] T024 [P] [US1] Create contract tests for admin routes in packages/web/src/app/api/__tests__/admin.test.ts: test change-status valid/invalid transitions, test rotate-key for all targets, test revoke-member with admin checks. Mock Supabase client.

**Checkpoint**: All 13 API routes deployed. Contract tests pass. Each route produces identical output to its EF.

---

## Phase 3: US2 — Update CLI to Use HOSTED_API_URL

**Goal**: CLI hosted-mode calls route through Vercel API routes instead of Supabase EFs

**Independent Test**: Point HOSTED_API_URL at Vercel. Run `teamind init` (Hosted). Verify via Vercel logs that all API calls hit /api/ routes.

- [ ] T025 [US2] Update packages/cli/src/cloud/registration.ts: import `HOSTED_API_URL` and `resolveApiPath` from api-url.ts. In `resolveBaseUrl()`, when the supabaseUrl matches HOSTED_SUPABASE_URL, return HOSTED_API_URL instead. In `register()`, change URL from `${base}/functions/v1/register` to `${resolveApiPath(base, 'register')}`. In `joinPublic()`, change URL from `${base}/functions/v1/join-project` to `${resolveApiPath(base, 'join-project')}`.

- [ ] T026 [US2] Update packages/cli/src/auth/jwt.ts: import `resolveApiPath` and `isHostedMode` helpers. In `exchangeToken()`, change URL from `${supabaseUrl}/functions/v1/exchange-token` to `${resolveApiPath(resolveApiUrl(supabaseUrl, isHosted), 'exchange-token')}`. Add `isHosted` parameter or detect from supabaseUrl matching HOSTED_SUPABASE_URL. Ensure community mode still uses /functions/v1/ path.

- [ ] T027 [US2] Update packages/cli/src/billing/usage.ts: import `resolveApiPath` and `isHostedMode` helpers. In `checkUsageOrProceed()`, change URL from `${supabaseUrl}/functions/v1/check-usage` to `${resolveApiPath(resolveApiUrl(supabaseUrl, isHosted), 'check-usage')}`. Detect hosted mode from supabaseUrl or pass as parameter. Preserve fail-open guarantee and 3s timeout.

- [ ] T028 [US2] Update packages/cli/src/commands/init.ts: import `resolveApiPath`, `resolveApiUrl`, `HOSTED_API_URL`. In `createOrg()` function, change EF call URL from `${supabaseUrl}/functions/v1/create-org` to `${resolveApiPath(resolveApiUrl(supabaseUrl, supabaseUrl === HOSTED_SUPABASE_URL), 'create-org')}`. Preserve community fallback to direct SQL (the `catch` branch).

- [ ] T029 [US2] Update packages/cli/src/cloud/supabase.ts: find any Edge Function calls in createProject() and joinProject() functions. If they call `/functions/v1/create-project` or `/functions/v1/join-project`, update them to use `resolveApiPath()` for hosted mode. Verify: check if these functions exist and whether they call EFs or use direct Supabase client queries.

- [ ] T030 [P] [US2] Unit tests for URL resolution in packages/cli/test/cloud/api-url.test.ts (new file): test `resolveApiUrl` returns HOSTED_API_URL when supabaseUrl matches HOSTED_SUPABASE_URL, test it returns supabaseUrl for community mode. Test `resolveApiPath` returns `/api/<name>` for hosted, `/functions/v1/<name>` for community. Test `isHostedMode` detects hosted config correctly.

- [ ] T031 [P] [US2] Integration test: verify all CLI EF call sites use resolveApiPath in packages/cli/test/cloud/api-url.test.ts (extend): grep codebase for `/functions/v1/` in packages/cli/src/ — each occurrence should be in a community-mode code path or use resolveApiPath. No hardcoded `/functions/v1/` calls in hosted mode.

**Checkpoint**: CLI hosted-mode API calls route to `https://teamind.krukit.co/api/<name>`. Community mode unchanged.

---

## Phase 4: US3 — Hosted Enrichment Route

**Goal**: New `/api/enrich` endpoint enables server-side enrichment for hosted users

**Independent Test**: Store a pending decision. Call `/api/enrich` with the decision ID. Verify enrichment results.

- [ ] T032 [US3] Create enrichment API route in packages/web/src/app/api/enrich/route.ts: export `POST(request: NextRequest)`. Authenticate via Bearer JWT (decode JWT, extract org_id + project_id + member_id). Accept `{ decision_ids: string[] }` (max 20 per call). Fetch decisions from Postgres filtered by org_id + project_id + decision_ids. Skip decisions that are already enriched (enriched_by is not null). Check daily enrichment budget via enrichment_usage table. Call Anthropic API (Messages API) for each unenriched decision: system prompt asks for JSON with type, summary, affects, confidence. Update Postgres: set type, summary, affects, confidence, enriched_by='llm'. Update Qdrant: sync payload. Log to enrichment_usage table (org_id, date, provider='anthropic', decisions_enriched, tokens_used, cost_cents). Return enrichment results. Use `ANTHROPIC_API_KEY` from process.env. Return 503 if not configured. Return 403 for community users (detect from JWT claims or missing hosted marker).

- [ ] T033 [P] [US3] Create Anthropic client helper in packages/web/src/lib/anthropic.ts (new file): export `enrichDecision(text: string): Promise<{ type, summary, affects, confidence, tokens_used }>`. Uses fetch to call Anthropic Messages API with model `claude-sonnet-4-20250514`. System prompt: "Classify this development decision. Return JSON: {type: 'decision'|'constraint'|'pattern'|'lesson', summary: string (1 sentence), affects: string[] (areas), confidence: number (0-1)}". Parse response. Calculate cost_cents from token counts.

- [ ] T034 [P] [US3] Create Qdrant sync helper in packages/web/src/lib/qdrant-server.ts (new file): export `updateDecisionPayload(decisionId: string, orgId: string, payload: Record<string, unknown>): Promise<void>`. Uses QDRANT_URL + QDRANT_API_KEY from process.env to call Qdrant REST API for payload updates. This is used by the enrich route to sync enriched fields to Qdrant.

- [ ] T035 [P] [US3] Contract test for enrich route in packages/web/src/app/api/__tests__/enrich.test.ts: test authenticated request enriches decisions, test unauthenticated returns 401, test missing ANTHROPIC_API_KEY returns 503, test daily budget exceeded returns 429, test already-enriched decisions are skipped, test max 20 decisions per call enforced. Mock Anthropic API and Supabase client.

**Checkpoint**: Hosted users can enrich pending decisions via `/api/enrich`. Cost ceiling enforced.

---

## Phase 5: US4 + US5 — Community Verification & Cleanup

**Goal**: Verify community mode unchanged. Deprecate Supabase EFs. Document Stripe webhook URL change.

**Independent Test**: Community init + operations work. Hosted mode works with EFs disabled.

### Community Verification (US4)

- [ ] T036 [US4] Verify community mode path in packages/cli/src/commands/init.ts: confirm community mode createOrg() still falls through to direct SQL for non-Supabase-EF cases. Confirm community mode prompts for 4 credentials. Confirm community mode config saves supabase_service_role_key. Confirm no HOSTED_API_URL references in community code paths.

- [ ] T037 [P] [US4] Integration test for community mode in packages/cli/test/commands/init-community.test.ts (new file): test that community init prompts for Supabase URL, Service Role Key, Qdrant URL, Qdrant API Key. Test that saved config includes supabase_service_role_key. Test that no calls to HOSTED_API_URL are made. Test that EF calls use /functions/v1/ path.

### EF Deprecation (US5)

- [ ] T038 [P] [US5] Add deprecation notice to supabase/functions/register/index.ts: add JSDoc comment at top of file: `@deprecated Migrated to Vercel API route: packages/web/src/app/api/register/route.ts. This Edge Function is kept for community/self-hosted deployments only.`

- [ ] T039 [P] [US5] Add deprecation notice to supabase/functions/exchange-token/index.ts, supabase/functions/check-usage/index.ts, supabase/functions/join-project/index.ts: same deprecation notice pattern as T038, with correct API route path for each.

- [ ] T040 [P] [US5] Add deprecation notice to remaining 9 EFs (join-org, create-org, create-project, change-status, rotate-key, revoke-member, seed, stripe-webhook, create-checkout): same deprecation notice pattern as T038, each pointing to its corresponding API route.

- [ ] T041 [P] [US5] Document Stripe webhook URL change: add a section to specs/006-vercel-api-migration/quickstart.md or create a deployment note file. State that the Stripe dashboard webhook endpoint must be updated from `https://rmawxpdaudinbansjfpd.supabase.co/functions/v1/stripe-webhook` to `https://teamind.krukit.co/api/stripe-webhook` after migration. Include both old and new URLs.

**Checkpoint**: Community mode verified unchanged. All EFs deprecated with notices. Stripe webhook URL documented.

---

## Phase 6: Polish

**Purpose**: Full suite validation, end-to-end tests, documentation

- [ ] T042 [P] End-to-end test for full hosted flow via Vercel API routes: init (register) -> exchange-token -> check-usage -> store -> search -> lifecycle. Verify all calls route through /api/ paths (not /functions/v1/). In packages/cli/test/integration/vercel-migration.test.ts (new file).

- [ ] T043 [P] End-to-end test for hosted enrichment: store pending decision -> call /api/enrich -> verify decision updated with type, summary, affects, confidence, enriched_by='llm'. In packages/cli/test/integration/vercel-migration.test.ts (extend).

- [ ] T044 [P] Static analysis: grep packages/cli/src/ for hardcoded `/functions/v1/` URLs in hosted-mode code paths. Each occurrence must either be in a community-mode branch or use resolveApiPath(). No direct EF URLs in hosted mode. In packages/cli/test/integration/vercel-migration.test.ts (extend).

- [ ] T045 Run full test suite (npm test && npm run lint) to verify all existing tests pass, no regressions from URL changes, type changes, or new dependencies. In packages/cli/ and packages/web/ (verify).

- [ ] T046 Run quickstart.md validation: execute all 5 user story scenarios manually on a deployed Vercel instance. Verify all checklist items pass in specs/006-vercel-api-migration/quickstart.md (verify).

- [ ] T047 [P] Update packages/web/.env.example (create if needed): list all required environment variables for Vercel deployment (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, QDRANT_URL, QDRANT_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_TEAM_MONTHLY, STRIPE_PRICE_TEAM_ANNUAL, STRIPE_PRICE_BUSINESS_MONTHLY, STRIPE_PRICE_BUSINESS_ANNUAL, ANTHROPIC_API_KEY).

**Checkpoint**: All tests pass. All user stories validated. Feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — can start immediately
- **Phase 2 (US1)**: Depends on Phase 1 (shared utilities must exist before routes)
- **Phase 3 (US2)**: Depends on Phase 1 (HOSTED_API_URL + resolveApiPath); can run in parallel with Phase 2 since CLI and web are different packages
- **Phase 4 (US3)**: Depends on Phase 1 (shared utilities); can run in parallel with Phase 2 and 3
- **Phase 5 (US4+US5)**: Depends on Phase 2 (routes must exist before verifying them); Phase 3 (CLI must be updated)
- **Phase 6 (Polish)**: Depends on all previous phases

### Within Each Phase

- Tasks marked [P] can run in parallel
- Web package tasks and CLI package tasks can be developed in parallel
- Test tasks can run after their corresponding implementation tasks

### Parallel Opportunities

- T001-T008 (Phase 1) — all parallel, different files
- T009-T020 (Phase 2 routes) — mostly parallel after T009 (register may set patterns others follow)
- T021-T024 (Phase 2 tests) — parallel with each other, after their route implementations
- T025-T029 (Phase 3 CLI updates) — sequential within each file, but different files are parallel
- T032-T034 (Phase 4 enrich) — T033 and T034 parallel, T032 depends on both
- T036-T041 (Phase 5) — all parallel
- T042-T047 (Phase 6) — parallel tests, sequential final validation

### Critical Path

1. T001-T006 (shared utilities) -> T009 (register route, sets pattern) -> T013 (exchange-token, security-critical) -> T025-T028 (CLI updates) -> T042 (e2e test)
2. Parallel: T010-T012, T014-T020 (remaining routes) alongside T025-T028 (CLI)
3. T032 (enrich route) can start after T003-T006 (shared utilities)

---

## Implementation Strategy

### MVP First (Phase 1 + Phase 2 partial)

1. Complete Phase 1: Setup (T001-T008)
2. Implement 3 critical routes: register (T009), exchange-token (T013), check-usage (T014)
3. Update CLI for these 3 routes: registration.ts (T025), jwt.ts (T026), usage.ts (T027)
4. **STOP and VALIDATE**: `teamind init` Hosted works via Vercel

### Incremental Delivery

1. Phase 1 + 3 critical routes -> Hosted init + auth works (MVP)
2. Remaining 10 routes (T010-T012, T015-T020) -> Full API parity
3. Phase 3 CLI updates (T025-T031) -> CLI fully migrated
4. Phase 4 enrich (T032-T035) -> Hosted enrichment available
5. Phase 5 cleanup (T036-T041) -> EFs deprecated, community verified
6. Phase 6 polish (T042-T047) -> Full test suite + validation

---

## Notes

- Total: 47 tasks (T001-T047)
- [P] tasks = different files, no dependencies
- [USX] label maps task to specific user story
- The register and exchange-token routes are the critical path — migrate and test them first
- Stripe webhook route needs special attention: raw body parsing + signature verification
- The enrich route (T032) is entirely new code, not a migration
- Community mode requires NO code changes — only verification (T036-T037)
- EFs are deprecated, not deleted — community users still need them

<!--
## Analysis: FR-to-Task Mapping

| FR | Description | Task IDs | Coverage |
|----|-------------|----------|----------|
| FR-001 | 14 Next.js API routes in packages/web/src/app/api/ | T009-T020, T032 | FULL — 13 migrated routes (T009-T020) + 1 new enrich route (T032) |
| FR-002 | Each route preserves exact request/response contract | T009-T020, T021-T024 | FULL — each route preserves contract, tests verify (T021-T024) |
| FR-003 | Routes use process.env (not Deno.env.get) | T009-T020 | FULL — every route task specifies Deno.env.get -> process.env |
| FR-004 | Imports from npm (not esm.sh/deno.land) | T001, T009-T020 | FULL — T001 adds deps, each route replaces imports |
| FR-005 | exchange-token uses jose from npm, identical JWTs | T001, T013, T022 | FULL — T001 adds jose, T013 migrates signing, T022 verifies |
| FR-006 | CORS handled globally via next.config.ts | T002 | FULL — T002 adds CORS headers to next.config.ts |
| FR-007 | HOSTED_API_URL constant in CLI | T007 | FULL — T007 adds constant to types.ts |
| FR-008 | Hosted CLI calls use HOSTED_API_URL/api/<name> | T008, T025-T029 | FULL — T008 creates resolver, T025-T029 update each call site |
| FR-009 | Community CLI calls unchanged (/functions/v1/) | T008, T030-T031, T036-T037 | FULL — T008 resolver preserves community path, T030-T031 test it, T036-T037 verify |
| FR-010 | /api/enrich with JWT auth + server ANTHROPIC_API_KEY | T032, T033 | FULL — T032 creates route, T033 creates Anthropic client |
| FR-011 | Enrichment daily cost ceiling via enrichment_usage | T032 | FULL — T032 implements budget check in enrich route |
| FR-012 | Shared supabase-server.ts utility | T003 | FULL — T003 creates the shared client |
| FR-013 | EFs remain deployable for community | T038-T040 | FULL — deprecation notices added, code not deleted |
| FR-014 | Stripe webhook URL change documented | T041 | FULL — T041 documents the URL change |

## Constitution Compliance

| # | Principle | Status | Relevant Tasks |
|---|-----------|--------|----------------|
| I | Cloud-First | PASS | T009-T020 (cloud API routes), T032 (cloud enrichment) |
| II | Minimally Invasive | PASS | No IDE changes — CLI URL prefix changes only |
| III | Non-Blocking | PASS | T027 (fail-open preserved in check-usage), T026 (offline fallback preserved in jwt.ts) |
| IV | No LLM Dependency | PASS | Core ops have no LLM. T032 enrich is optional. |
| V | Zero Native Dependencies | PASS | T001 adds stripe + jose (pure JS). No native deps. |
| VI | Auto-Capture by Default | PASS | Capture unchanged — only URL routing changes |
| VII | Dual Storage | PASS | T020 (seed route writes both), T032 (enrich updates both) |
| VIII | Push + Pull | PASS | Realtime unchanged (Supabase Realtime, not EFs) |
| IX | Decision Lifecycle | PASS | T017 (change-status route preserves lifecycle logic) |
| X | Identity-First Access | PASS | T013 (exchange-token produces identical JWTs), T005 (api-auth.ts preserves per-member auth) |
| XI | Project-Scoped Isolation | PASS | T013 (JWT includes project_id/project_role claims) |

## Gap Analysis

- **No gaps identified.** All 14 FRs are covered by at least one task.
- **All 11 constitution principles pass.** No regressions.
- **All 5 user stories have dedicated phases** with independent tests.
- **Success criteria coverage**:
  - SC-001 (13 EF contracts replicated): T009-T020 + T021-T024 (contract tests)
  - SC-002 (full hosted flow via Vercel): T025-T029 + T042 (e2e test)
  - SC-003 (hosted enrichment works): T032-T035
  - SC-004 (community unchanged): T036-T037
  - SC-005 (cold-start < 500ms): T046 (quickstart validation)
  - SC-006 (all tests pass): T045
-->
