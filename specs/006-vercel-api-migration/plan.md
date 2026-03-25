# Implementation Plan: Vercel API Migration

**Branch**: `006-vercel-api-migration` | **Date**: 2026-03-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-vercel-api-migration/spec.md`

## Summary

Migrate 13 Supabase Deno Edge Functions to Next.js App Router API
routes in `packages/web/src/app/api/`. Add a new `/api/enrich` route
for server-side enrichment using the Anthropic API key. Update the CLI
to route hosted-mode API calls through `HOSTED_API_URL`
(`https://valis.krukit.co`) instead of Supabase EF URLs. Community
mode remains unchanged (still calls Supabase EFs directly). Reduce
Supabase's role to Postgres + Realtime only.

This is a medium-sized feature (~45 tasks) that rewrites 13 handlers
from Deno to Node.js, extracts shared utilities, updates 6 CLI modules,
adds 1 new endpoint, and validates backward compatibility.

## Technical Context

**Language/Version**: TypeScript (ES2022, NodeNext module resolution), Node.js 20+
**Web Framework**: Next.js 15 App Router (existing `packages/web`)
**Primary Dependencies**: Existing deps + `stripe` (npm), `jose` (npm) added to `packages/web`
**Storage**: Supabase Postgres (unchanged) + Qdrant Cloud (unchanged)
**Auth Model**: Per-member API keys (`tmm_` prefix) + JWT via `exchange-token`. JWT signing moves from Deno jose to npm jose (identical library, different import path).
**Config**: New `HOSTED_API_URL` constant. `HOSTED_SUPABASE_URL` unchanged.
**Testing**: vitest (CLI), Next.js route handler testing (web). Contract tests per route.
**Target Platform**: Vercel (serverless functions, Node.js runtime)
**Performance Goals**: API route cold-start < 500ms. Same response times as EFs.
**Constraints**: Zero breaking changes to request/response contracts. Community mode unchanged. EFs preserved for self-hosted.
**Scale/Scope**: 14 API routes, 4 shared utility modules, 6 CLI module updates, ~45 tasks

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Cloud-First | PASS | API routes are cloud-deployed on Vercel. Registration, auth, and enrichment remain cloud services. |
| II | Minimally Invasive | PASS | No IDE integration changes. CLI calls change URL prefix only — same payloads, same auth flow. |
| III | Non-Blocking | PASS | Fail-open guarantee preserved in check-usage. Offline queue unchanged. Error messages preserved. |
| IV | No LLM Dependency | PASS | Core ops (store/search/context) have no LLM calls. Enrichment is optional (new /api/enrich endpoint). |
| V | Zero Native Dependencies | PASS | `stripe` and `jose` are pure JS packages. No native compilation needed. |
| VI | Auto-Capture by Default | PASS | Capture layers unchanged. Only the URL that EF calls hit changes. |
| VII | Dual Storage | PASS | Store/search still write to both Postgres and Qdrant. No storage changes. |
| VIII | Push + Pull | PASS | Realtime subscriptions still use Supabase Realtime (unchanged). API routes don't affect push. |
| IX | Decision Lifecycle | PASS | change-status route preserves identical lifecycle logic (valid transitions, audit trail). |
| X | Identity-First Access Control | PASS | Per-member API keys and JWT auth unchanged. exchange-token produces identical JWTs. |
| XI | Project-Scoped Isolation | PASS | Project-scoped RLS enforced by JWT claims — minted by same logic, different runtime. |

**Security & Data Integrity**: Service_role key is a server-side env
var on Vercel (same as Supabase EF runtime). JWT_SECRET is a server-side
env var. Timing-safe comparison migrated from `crypto.subtle` to
`node:crypto`. Rate limiting preserved. Stripe webhook signature
verification preserved.

**Development Workflow**: No new migrations. No schema changes. All
existing migrations continue to work. New npm dependencies (`stripe`,
`jose`) added to `packages/web` only.

## Project Structure

### Documentation (this feature)

```text
specs/006-vercel-api-migration/
├── plan.md              # This file
├── spec.md              # Feature specification with 5 user stories
├── research.md          # Deno-to-Node mapping, URL strategy, enrichment design
├── quickstart.md        # Validation checklist for all 5 user stories
├── checklists/
│   └── requirements.md  # FR-to-checklist mapping
├── contracts/
│   └── api-routes.md    # All 14 API route contracts
└── tasks.md             # Implementation tasks (~45 tasks, 6 phases)
```

### Source Code (changes to repository)

```text
packages/web/
├── package.json                         # MODIFIED: add stripe, jose deps
├── next.config.ts                       # MODIFIED: add CORS headers for /api/*
├── src/
│   ├── lib/
│   │   ├── supabase-server.ts           # NEW: shared Supabase server client
│   │   ├── api-auth.ts                  # NEW: extractBearerToken, authenticateApiKey
│   │   ├── api-response.ts              # NEW: jsonResponse, unauthorized, forbidden, etc.
│   │   └── api-keys.ts                  # NEW: generateOrgApiKey, generateMemberKey, etc.
│   └── app/
│       └── api/
│           ├── register/route.ts        # NEW: migrated from supabase/functions/register/
│           ├── join-project/route.ts     # NEW: migrated from supabase/functions/join-project/
│           ├── join-org/route.ts         # NEW: migrated from supabase/functions/join-org/
│           ├── create-org/route.ts       # NEW: migrated from supabase/functions/create-org/
│           ├── create-project/route.ts   # NEW: migrated from supabase/functions/create-project/
│           ├── exchange-token/route.ts   # NEW: migrated from supabase/functions/exchange-token/
│           ├── change-status/route.ts    # NEW: migrated from supabase/functions/change-status/
│           ├── rotate-key/route.ts       # NEW: migrated from supabase/functions/rotate-key/
│           ├── revoke-member/route.ts    # NEW: migrated from supabase/functions/revoke-member/
│           ├── check-usage/route.ts      # NEW: migrated from supabase/functions/check-usage/
│           ├── stripe-webhook/route.ts   # NEW: migrated from supabase/functions/stripe-webhook/
│           ├── create-checkout/route.ts  # NEW: migrated from supabase/functions/create-checkout/
│           ├── seed/route.ts             # NEW: migrated from supabase/functions/seed/
│           └── enrich/route.ts           # NEW: hosted enrichment endpoint

packages/cli/src/
├── types.ts                             # MODIFIED: add HOSTED_API_URL constant
├── cloud/
│   ├── registration.ts                  # MODIFIED: use resolveApiUrl for URL construction
│   └── supabase.ts                      # MODIFIED: EF calls use resolveApiUrl
├── auth/
│   └── jwt.ts                           # MODIFIED: exchangeToken uses resolveApiUrl
├── billing/
│   └── usage.ts                         # MODIFIED: checkUsage uses resolveApiUrl
└── commands/
    └── init.ts                          # MODIFIED: createOrg EF call uses resolveApiUrl

supabase/functions/
├── (all 13 existing)                    # MODIFIED: add deprecation headers
```

**Structure Decision**: API routes are co-located with the existing
web dashboard in `packages/web`. This means a single Vercel deployment
serves both the dashboard UI and the API routes. No new package needed.

## Complexity Tracking

> No Constitution Check violations. All 11 principles pass.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | — |
