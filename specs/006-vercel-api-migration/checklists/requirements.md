# Requirements Checklist: Vercel API Migration

**Spec**: [../spec.md](../spec.md)
**Date**: 2026-03-25

## Functional Requirements

- [ ] **FR-001**: 14 Next.js API routes exist in `packages/web/src/app/api/` (13 migrated + 1 new enrich)
- [ ] **FR-002**: Each route preserves exact request/response contract of its Edge Function
  - [ ] register: POST, same JSON shape, same status codes (201, 400, 409, 429)
  - [ ] join-project: POST, same JSON shape, same status codes (200, 400, 404, 409, 403)
  - [ ] join-org: POST, same JSON shape, same status codes (200, 400, 404, 403)
  - [ ] create-org: POST, same JSON shape, same status codes (200, 400, 500)
  - [ ] create-project: POST, same JSON shape, same status codes (200, 400, 401, 403)
  - [ ] exchange-token: POST, same JWT shape, same status codes (200, 401, 403, 500)
  - [ ] change-status: POST, same JSON shape, same status codes (200, 400, 401, 403, 404)
  - [ ] rotate-key: POST, same JSON shape, same status codes (200, 400, 401, 403, 404)
  - [ ] revoke-member: POST, same JSON shape, same status codes (200, 400, 401, 403, 404)
  - [ ] check-usage: POST, same JSON shape, same status codes (200, 401)
  - [ ] stripe-webhook: POST, same event handling, same status codes (200, 400)
  - [ ] create-checkout: POST, same JSON shape, same status codes (200, 400, 401, 500)
  - [ ] seed: POST, same JSON shape, same status codes (200, 401, 400)
- [ ] **FR-003**: All routes use `process.env.X` (zero `Deno.env.get` references)
- [ ] **FR-004**: All imports from npm packages (zero `esm.sh` or `deno.land` references)
- [ ] **FR-005**: exchange-token route uses `jose` from npm, produces identical JWTs
- [ ] **FR-006**: CORS handled globally in `next.config.ts` (no per-route corsHeaders)
- [ ] **FR-007**: `HOSTED_API_URL` constant added to `packages/cli/src/types.ts`
- [ ] **FR-008**: Hosted-mode CLI calls use `${HOSTED_API_URL}/api/<name>` URL pattern
  - [ ] registration.ts: register() uses HOSTED_API_URL
  - [ ] registration.ts: joinPublic() uses HOSTED_API_URL
  - [ ] jwt.ts: exchangeToken() uses HOSTED_API_URL for hosted mode
  - [ ] usage.ts: checkUsageOrProceed() uses HOSTED_API_URL for hosted mode
  - [ ] init.ts: createOrg() uses HOSTED_API_URL for hosted mode
  - [ ] supabase.ts: createProject/joinProject use HOSTED_API_URL for hosted mode
- [ ] **FR-009**: Community-mode CLI calls still use `${supabaseUrl}/functions/v1/<name>`
- [ ] **FR-010**: `/api/enrich` route authenticates via JWT, enriches via server-side ANTHROPIC_API_KEY
- [ ] **FR-011**: Enrichment enforces daily cost ceiling via `enrichment_usage` table
- [ ] **FR-012**: Shared `supabase-server.ts` utility created in `packages/web/src/lib/`
- [ ] **FR-013**: Supabase EFs remain deployable for community users (not deleted)
- [ ] **FR-014**: Stripe webhook URL change documented

## User Stories

### US1 — Migrate Edge Functions to Vercel API Routes
- [ ] All 13 EF handlers converted to `export async function POST(request: Request)`
- [ ] All `serve()` wrappers removed
- [ ] All `Deno.env.get()` replaced with `process.env`
- [ ] All `esm.sh` imports replaced with npm imports
- [ ] All `deno.land` imports replaced with npm imports
- [ ] `corsHeaders` removed from individual routes
- [ ] Shared helper utilities extracted (auth, responses, key generation)
- [ ] All routes tested with same inputs as Edge Functions

### US2 — CLI Points to Vercel API URL
- [ ] `HOSTED_API_URL` constant defined in types.ts
- [ ] `resolveApiUrl()` helper distinguishes hosted vs community
- [ ] registration.ts updated to use HOSTED_API_URL
- [ ] jwt.ts exchangeToken() updated for hosted mode
- [ ] usage.ts checkUsageOrProceed() updated for hosted mode
- [ ] init.ts createOrg() EF call updated for hosted mode
- [ ] supabase.ts create-project/join-project calls updated for hosted mode

### US3 — Hosted Enrichment
- [ ] `/api/enrich/route.ts` created
- [ ] JWT authentication enforced
- [ ] Server-side ANTHROPIC_API_KEY used
- [ ] Decisions updated in Postgres with type, summary, affects, confidence
- [ ] Qdrant payload updated with enriched fields
- [ ] `enriched_by: 'llm'` set on enriched decisions
- [ ] Daily cost ceiling enforced per org
- [ ] Error handling: missing ANTHROPIC_API_KEY -> 503

### US4 — Community Mode Unchanged
- [ ] Community mode init flow unchanged
- [ ] Community mode API calls still use supabaseUrl + /functions/v1/
- [ ] Community mode enrichment uses local CLI with user's own keys
- [ ] All existing tests pass

### US5 — Remove Supabase EF Dependency
- [ ] Deprecation headers added to each EF in supabase/functions/
- [ ] Documentation updated: Supabase role = Postgres + Realtime only
- [ ] Stripe webhook URL update documented
- [ ] EFs NOT deleted (kept for community deployments)

## Success Criteria
- [ ] **SC-001**: All 13 EF contracts replicated (contract tests pass)
- [ ] **SC-002**: Full hosted flow works via Vercel (register -> store -> search -> lifecycle)
- [ ] **SC-003**: Hosted enrichment works (/api/enrich with server Anthropic key)
- [ ] **SC-004**: Community mode unchanged (existing tests pass)
- [ ] **SC-005**: API route cold-start < 500ms
- [ ] **SC-006**: All existing tests pass (no regressions)
