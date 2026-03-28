# Valis Product Backlog

## Current: Pre-Release

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Deploy Supabase migrations (001-007) | Not started | `supabase db push` |
| 2 | Deploy Vercel API routes (replaces Edge Functions for hosted) | Not started | `vercel deploy` |
| 3 | Set env vars (JWT_SECRET, QDRANT_URL, QDRANT_API_KEY, STRIPE_*) | Not started | Via Vercel Dashboard |
| 4 | ~~Set HOSTED URLs~~ | ✅ Done | Real URLs now in types.ts |
| 5 | Enable Supabase Realtime | Not started | **Blocker** — required for cross-session push |
| 6 | npm link + rebuild + test `valis init` e2e | Not started | |
| 7 | Deploy web dashboard UI | Not started | **Blocker** — dashboard route exists, needs UI deploy |
| 8 | Deploy runbook (step-by-step guide) | Not started | **Blocker** — write before deploy |
| 9 | E2E tests per quickstart.md | Not started | **Blocker** — verify full flow before release |
| 10 | **Dog fooding** (several weeks) | Not started | Owner: Todmy. Real project testing. |

**Domain**: `valis.krukit.co` (subdomain of main domain)

## Blockers Found During Review

| # | Issue | Priority | Notes |
|---|-------|----------|-------|
| 11 | ~~**rate_limits not incremented**~~ | ✅ Done | Fixed in 006: Vercel API routes increment rate_limits on store/search (migration 007) |
| 12 | ~~**Qdrant hosted mode**~~ | ✅ Done | Fixed in 006: search proxied through Vercel API route `/api/search` |
| 13 | ~~**Enrichment for hosted**~~ | ✅ Done | Fixed in 006: server-side enrichment via `/api/enrich` using platform Anthropic key |

## Phase 4B: Go to Market (after dog fooding)

| # | Feature | Effort | Notes |
|---|---------|--------|-------|
| 14 | Billing integration (Stripe) — deploy products, prices, webhook | 3-5 days | Code exists, deploy after dog fooding |
| 15 | Pricing page at valis.krukit.co | 3-5 days | |
| 16 | Annual prepay discount (20%) | 1-2 days | Depends on Stripe |
| 17 | Device Authorization Grant (RFC 8628) | 2-3 days | Better dashboard auth UX |

## Infrastructure Optimization

| # | Item | Priority | Notes |
|---|------|----------|-------|
| 18 | ~~**Move high-frequency EFs to Vercel**~~ | ✅ Done | All 15 API routes migrated to Vercel in phase 006 |
| 19 | **Realtime push cost** — Supabase: 200 connections (free), 500 (pro). Monitor during dog fooding. | MEDIUM | |
| 20 | ~~**Server-side enrichment**~~ | ✅ Done | `/api/enrich` route in phase 006 |

## Conversion Flows

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 21 | **Community → Hosted migration** — export local Postgres → import to Supabase → update config. Preserve decisions, members, audit. | Medium | Backlog |
| 22 | **Hosted → Community** — export from Supabase → import to local Docker. | Medium | Backlog |

## Phase 5: Platform

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| 23 | **Task Marketplace** — freelance platform on Valis KB. KB controls access, validates work. | Large | Idea |
| 24 | Selective Knowledge Sharing — per-task scoped access | Medium | Prerequisite for #23 |
| 25 | External member invites with task-scoped access | Medium | Prerequisite for #23 |
| 26 | Validation pipeline — KB checks PR against decisions | Medium | Idea |
| 27 | **Auto-consolidation via Claude Code hooks** — SessionEnd hook writes flag + timestamp to ~/.valis/consolidation-state.json; SessionStart hook checks 24h+5 sessions elapsed → runs `valis admin consolidate --auto-merge` as background process. Mimics Auto Dream pattern. Also explore Desktop Scheduled Tasks (persistent, cross-session). | Medium | Idea |

## Documentation Gaps

| # | Item | Priority |
|---|------|----------|
| 28 | Community Edition formal spec (Docker Compose, limitations vs hosted) | Medium — after release |
| 29 | Audit decisions log — 28 issues as ADRs | Medium |

## Technical Debt

| # | Item | Priority |
|---|------|----------|
| 30 | ~~Delete `export-cmd.ts` dead code~~ | ✅ Done |
| 31 | Golden test set — 50 query-result pairs for NDCG | Medium — after dog fooding (needs real queries) |
| 32 | ~~`.gitignore` for `.valis.json`~~ | ✅ Done |

## Completed Phases

| Phase | Feature | Spec |
|-------|---------|------|
| Q1 (001) | MVP — CLI + MCP + dual storage | `specs/001-valis-mvp/` |
| Q2 (002) | Retention & Enterprise — lifecycle, push, auth, RBAC | `specs/002-retention-enterprise/` |
| Q3 (003) | Search Intelligence & Growth — reranking, billing, cleanup | `specs/003-search-growth/` |
| Q4 (004) | Multi-Project — project-scoped isolation | `specs/004-multi-project/` |
| Q5 (005) | Registration API — zero-config hosted onboarding | `specs/005-registration-api/` |
| Q8 (006) | Vercel API Migration — 15 routes, rate limit increment, server enrichment | `specs/006-vercel-api-migration/` |
| Q9 | Community Edition — Docker Compose self-hosted | `community/` |
| — | 3 Audit Rounds — 28 issues resolved | main branch |
