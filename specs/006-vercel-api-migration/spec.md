# Feature Specification: Vercel API Migration

**Feature Branch**: `006-vercel-api-migration`
**Created**: 2026-03-25
**Status**: Draft
**Input**: Migrate 13 Supabase Deno Edge Functions to Next.js API routes in packages/web, add hosted enrichment endpoint, update CLI to use Vercel API URL

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Migrate Edge Functions to Vercel API Routes (Priority: P1)

All 13 Supabase Deno Edge Functions are rewritten as Next.js App Router
API routes in `packages/web/src/app/api/`. Each route preserves the
exact request/response contract of its corresponding Edge Function. The
Deno-specific patterns (`serve()`, `Deno.env.get()`, `esm.sh` imports)
are replaced with Node.js equivalents (`export async function POST()`,
`process.env`, npm imports). CORS is handled globally via
`next.config.ts` instead of per-function headers.

**Why this priority**: This is the core migration. Every other user
story depends on the API routes existing and being functionally
equivalent to the Edge Functions. Supabase charges per invocation after
500K/month; Vercel includes serverless functions in its plan.

**Independent Test**: Deploy the Next.js app to Vercel. Point the CLI
at the Vercel URL. Run `teamind init` (Hosted) -> register -> store ->
search -> lifecycle. All operations succeed via Vercel API routes.

**Acceptance Scenarios**:

1. **Given** the 13 Edge Functions exist in `supabase/functions/`,
   **When** the migration is complete, **Then** each has a corresponding
   Next.js API route in `packages/web/src/app/api/` with identical
   request/response shapes.
2. **Given** a Next.js API route handler, **When** it reads
   configuration, **Then** it uses `process.env.X` (not `Deno.env.get`).
3. **Given** a Next.js API route, **When** it creates a Supabase
   client, **Then** it imports `createClient` from
   `@supabase/supabase-js` (npm), not `esm.sh`.
4. **Given** a Next.js API route, **When** it signs JWTs, **Then** it
   imports `jose` from npm, not `deno.land`.
5. **Given** the `exchange-token` API route, **When** it receives a
   valid per-member API key, **Then** it returns the same JWT response
   as the Edge Function.
6. **Given** the `stripe-webhook` API route, **When** it receives a
   Stripe event, **Then** it verifies the signature and processes the
   event identically to the Edge Function.

---

### User Story 2 - CLI Points to Vercel API URL (Priority: P2)

The CLI's Edge Function calls (register, exchange-token, check-usage,
join-project, seed, create-org, create-project, etc.) are redirected
from `${supabaseUrl}/functions/v1/<name>` to
`${HOSTED_API_URL}/api/<name>`. A new constant `HOSTED_API_URL` is
added to `packages/cli/src/types.ts`. The `HOSTED_SUPABASE_URL` stays
for direct Supabase client queries (Postgres reads via supabase-js).

**Why this priority**: Without this, the CLI still calls Supabase EFs.
The API routes won't be used until the CLI is pointed at them.

**Independent Test**: Update `HOSTED_API_URL` to the Vercel deployment
URL. Run `teamind init` (Hosted) -> all calls route through Vercel.
Verify via Vercel logs that requests arrive at API routes.

**Acceptance Scenarios**:

1. **Given** the CLI config, **When** it calls `register`, **Then** it
   POSTs to `${HOSTED_API_URL}/api/register` (not
   `${supabaseUrl}/functions/v1/register`).
2. **Given** the CLI auth module, **When** it calls `exchange-token`,
   **Then** it POSTs to `${HOSTED_API_URL}/api/exchange-token`.
3. **Given** the CLI usage module, **When** it calls `check-usage`,
   **Then** it POSTs to `${HOSTED_API_URL}/api/check-usage`.
4. **Given** community mode, **When** the CLI calls any EF, **Then**
   it still uses `${supabaseUrl}/functions/v1/<name>` (direct Supabase
   EFs for community, since community users run their own Supabase).
5. **Given** a `HOSTED_API_URL` of `https://teamind.krukit.co`,
   **When** any hosted-mode API call is made, **Then** the URL is
   `https://teamind.krukit.co/api/<route-name>`.

---

### User Story 3 - Hosted Enrichment via Server-Side Anthropic Key (Priority: P3)

A new API route `/api/enrich` accepts an array of decision IDs and
enriches them using the server-side `ANTHROPIC_API_KEY` environment
variable. Hosted users call this endpoint (no local LLM key needed).
The route authenticates via Bearer JWT, looks up the decisions,
calls the Anthropic API for classification/summarization, and writes
the enriched data back to Postgres and Qdrant.

**Why this priority**: Enrichment for hosted users was flagged in the
backlog (item #10, #18). Without server-side enrichment, hosted users
must provide their own Anthropic API key — friction that reduces
activation.

**Independent Test**: Store a `type: 'pending'` decision via hosted
mode. Call `/api/enrich` with the decision ID. Verify the decision is
updated with type, summary, affects, confidence.

**Acceptance Scenarios**:

1. **Given** an authenticated hosted user, **When** they call
   `/api/enrich` with decision IDs, **Then** the server enriches
   each decision using the server-side Anthropic key.
2. **Given** the enrichment response, **When** it succeeds, **Then**
   each decision has `type`, `summary`, `affects`, `confidence`
   updated in Postgres and `enriched_by: 'llm'` set.
3. **Given** no `ANTHROPIC_API_KEY` on the server, **When** enrichment
   is called, **Then** it returns 503 with a clear message.
4. **Given** a community mode user, **When** they call `/api/enrich`,
   **Then** it returns 403 (community users use local `teamind enrich`
   with their own keys).

---

### User Story 4 - Community Mode Unchanged (Priority: P4)

Community mode users continue to use their own Supabase instance
directly. Their CLI calls go to `${supabaseUrl}/functions/v1/<name>`
as before. Direct Supabase client queries (store, search via supabase-js)
are unchanged. The migration only affects hosted mode routing.

**Why this priority**: Community/enterprise users must not be affected.
Their infrastructure is self-hosted and should not depend on Vercel.

**Independent Test**: Run `teamind init` -> Community -> enter own
credentials -> store -> search -> lifecycle. All operations work
exactly as before. No calls to Vercel.

**Acceptance Scenarios**:

1. **Given** community mode selected, **When** the CLI makes API
   calls, **Then** it uses `${supabaseUrl}/functions/v1/<name>` (not
   Vercel).
2. **Given** community mode config, **When** `teamind enrich` runs,
   **Then** it uses the local Anthropic key from config, not the
   server endpoint.
3. **Given** existing community mode tests, **When** run after
   migration, **Then** all pass unchanged.

---

### User Story 5 - Remove Supabase Edge Function Dependency (Priority: P5)

After migration is deployed and validated, the Supabase Edge Functions
are deprecated. The `supabase/functions/` directory is kept for
reference but is no longer deployed. Supabase's role is reduced to:
(1) Postgres database (migrations, RLS, RPC), (2) Realtime (WebSocket
push). No Edge Functions are deployed or invoked by hosted mode.

**Why this priority**: Cleanup. Reduces Supabase costs (no EF
invocations) and simplifies the deployment story. Only done after
all routes are validated on Vercel.

**Independent Test**: Disable all Supabase Edge Functions in the
dashboard. Run the full hosted flow. Everything works via Vercel.

**Acceptance Scenarios**:

1. **Given** all Supabase EFs are disabled, **When** hosted mode
   operations run, **Then** all succeed via Vercel API routes.
2. **Given** the codebase after migration, **When** `supabase/functions/`
   is reviewed, **Then** each function has a deprecation notice header
   pointing to the corresponding API route.
3. **Given** community mode, **When** EFs are still needed on
   community instances, **Then** the Edge Functions remain deployable
   for self-hosted users (kept in repo, not deleted).

---

### Edge Cases

- What happens when Vercel is down? Same as current EF-down behavior:
  fail-open for check-usage (FR-018 guarantee), offline queue for
  stores, clear error messages for auth failures.
- What happens with cold starts? Vercel serverless functions have
  ~200ms cold starts. Acceptable for API calls that were previously
  hitting Supabase EFs (~300ms cold starts).
- What happens to the web dashboard? It's already in `packages/web`
  and deploys to Vercel. API routes are co-located in the same
  deployment — no additional infrastructure.
- What happens with CORS? Next.js handles CORS via `next.config.ts`
  headers. Per-route CORS headers are removed (no more manual
  `corsHeaders` in each handler).
- What happens to Stripe webhooks? The webhook URL in the Stripe
  dashboard must be updated from
  `https://xyz.supabase.co/functions/v1/stripe-webhook` to
  `https://teamind.krukit.co/api/stripe-webhook`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide 14 Next.js API routes (13 migrated
  from EFs + 1 new enrichment route) in `packages/web/src/app/api/`.
- **FR-002**: Each API route MUST preserve the exact request/response
  contract of its corresponding Edge Function (same HTTP methods, same
  JSON shapes, same status codes).
- **FR-003**: API routes MUST use `process.env` for configuration
  (not `Deno.env.get`).
- **FR-004**: API routes MUST import dependencies from npm (not
  `esm.sh` or `deno.land`).
- **FR-005**: The `exchange-token` route MUST import `jose` from npm
  and produce identical JWTs to the Edge Function.
- **FR-006**: CORS MUST be handled globally via `next.config.ts`,
  not per-route.
- **FR-007**: The CLI MUST add a `HOSTED_API_URL` constant pointing
  to the Vercel deployment URL (`https://teamind.krukit.co`).
- **FR-008**: All hosted-mode CLI calls to Edge Functions MUST be
  redirected to `${HOSTED_API_URL}/api/<route-name>`.
- **FR-009**: Community mode CLI calls MUST continue using
  `${supabaseUrl}/functions/v1/<name>` unchanged.
- **FR-010**: The `/api/enrich` route MUST accept decision IDs,
  authenticate via Bearer JWT, enrich using server-side
  `ANTHROPIC_API_KEY`, and write results to Postgres + Qdrant.
- **FR-011**: The `/api/enrich` route MUST enforce daily cost ceiling
  per org (using `enrichment_usage` table).
- **FR-012**: A shared Supabase server client utility MUST be created
  in `packages/web/src/lib/supabase-server.ts` for use by all API
  routes (uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from
  `process.env`).
- **FR-013**: Existing Supabase Edge Functions MUST remain deployable
  for community self-hosted users.
- **FR-014**: The Stripe webhook URL MUST be documented for update
  in the Stripe dashboard after migration.

### Key Entities

- **API Route**: Next.js App Router route handler in
  `packages/web/src/app/api/<name>/route.ts`. Each exports
  `POST` (and optionally `OPTIONS` for legacy CORS).
- **HOSTED_API_URL**: New constant in CLI types.ts. Points to Vercel
  deployment. Used for all hosted-mode API calls.
- **Supabase Server Client**: Shared utility in packages/web for
  creating authenticated Supabase clients in API routes.

## Assumptions

- The Vercel deployment URL for the web package is
  `https://teamind.krukit.co` (already configured per BACKLOG.md).
- The web package (`packages/web`) is deployed to Vercel with all
  required environment variables (SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, QDRANT_URL, QDRANT_API_KEY,
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ANTHROPIC_API_KEY).
- Next.js 15+ App Router is used (already in package.json).
- The `stripe` npm package will be added to `packages/web` dependencies
  (replacing the Deno `esm.sh/stripe@14` import).
- The `jose` npm package will be added to `packages/web` dependencies
  (replacing the Deno `deno.land/x/jose` import).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 13 Edge Function behaviors are replicated in API
  routes with identical request/response contracts (verified by
  contract tests).
- **SC-002**: The CLI's hosted mode completes register -> store ->
  search -> lifecycle flow via Vercel API routes (zero EF calls).
- **SC-003**: Hosted enrichment works: pending decisions are enriched
  via `/api/enrich` using server-side Anthropic key.
- **SC-004**: Community mode is unchanged — all existing tests pass.
- **SC-005**: API route cold-start response times are under 500ms.
- **SC-006**: All existing tests pass after migration (no regressions).
