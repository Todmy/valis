# Teamind Product Backlog

## Current: Deploy + Dog Fooding

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Deploy Supabase migrations (001-005) | Not started | `supabase db push` |
| 2 | Deploy 13 Edge Functions | Not started | `supabase functions deploy` |
| 3 | Set EF env vars (JWT_SECRET, QDRANT_URL, QDRANT_API_KEY, STRIPE_*) | Not started | Via Supabase Dashboard or `supabase secrets set` |
| 4 | ~~Set HOSTED URLs~~ | ✅ Done | Real URLs now in types.ts |
| 5 | Enable Supabase Realtime | Not started | Dashboard → Settings → API → Realtime |
| 6 | npm link + rebuild + test `teamind init` e2e | Not started | |
| 7 | **Dog fooding** (several weeks) | Not started | Owner: Todmy. Real project testing. |

**Domain**: `teamind.krukit.co` (subdomain of main domain)

## Blockers Found During Review

| # | Issue | Priority | Notes |
|---|-------|----------|-------|
| 8 | **rate_limits not incremented** — check-usage EF checks limits but nobody inserts/increments daily counters after store/search. Limits never trigger. | HIGH | Need to add increment call after each store/search operation (in CLI or via EF) |
| 9 | **Qdrant hosted mode** — MCP search calls Qdrant directly but hosted mode has no qdrant_api_key on client. Search fails silently. | HIGH | Options: (a) expose read-only Qdrant key to hosted clients, (b) proxy search through EF, (c) return Qdrant read key from register response |
| 10 | **Enrichment for hosted** — hosted users should use OUR LLM keys (included in plan), not their own. Need server-side enrichment EF that uses our Anthropic key. | MEDIUM | Community users enter their own keys in global config |

## Phase 4B: Go to Market (after dog fooding)

| # | Feature | Effort | Notes |
|---|---------|--------|-------|
| 11 | Billing integration (Stripe) | 3-5 days | Code exists, deploy after dog fooding |
| 12 | Pricing page at teamind.krukit.co | 3-5 days | |
| 13 | Annual prepay discount (20%) | 1-2 days | Depends on Stripe |
| 14 | Device Authorization Grant (RFC 8628) | 2-3 days | Better dashboard auth UX |
| 15 | Deploy web dashboard to Vercel | 1 day | packages/web ready |

## Infrastructure Optimization

| # | Item | Priority | Notes |
|---|------|----------|-------|
| 16 | **Move high-frequency EFs to Vercel** — check-usage, exchange-token called on every store/search. Supabase charges per invocation after 500K/mo. Vercel Edge Functions included in plan (free/pro). Keep low-frequency EFs on Supabase (register, create-project, seed). | HIGH | Evaluate during dog fooding |
| 17 | **Realtime push cost** — Supabase: 200 connections (free), 500 (pro). Monitor during dog fooding. | MEDIUM | |
| 18 | **Server-side enrichment** — move enrichment to EF using our Anthropic key for hosted users. Community users use own keys via global config (~/.teamind/config.json). | MEDIUM | |

## Conversion Flows

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 19 | **Community → Hosted migration** — export local Postgres → import to Supabase → update config. Preserve decisions, members, audit. | Medium | Backlog |
| 20 | **Hosted → Community** — export from Supabase → import to local Docker. | Medium | Backlog |

## Phase 5: Platform

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| 21 | **Task Marketplace** — freelance platform on Teamind KB. KB controls access, validates work. | Large | Idea |
| 22 | Selective Knowledge Sharing — per-task scoped access | Medium | Prerequisite for #21 |
| 23 | External member invites with task-scoped access | Medium | Prerequisite for #21 |
| 24 | Validation pipeline — KB checks PR against decisions | Medium | Idea |

## Documentation Gaps

| # | Item | Priority |
|---|------|----------|
| 25 | Community Edition formal spec (Docker Compose, limitations vs hosted) | Medium |
| 26 | Audit decisions log — 28 issues as ADRs | Medium |
| 27 | Deploy runbook (step-by-step Supabase + Qdrant + Vercel) | HIGH |

## Technical Debt

| # | Item | Priority |
|---|------|----------|
| 28 | Delete `export-cmd.ts` dead code | Low |
| 29 | Golden test set — 50 query-result pairs for NDCG | Medium |
| 30 | E2E tests per quickstart.md | Medium |
| 31 | ~~`.gitignore` for `.teamind.json`~~ | ✅ Done |

## Completed Phases

| Phase | Feature | Spec |
|-------|---------|------|
| 001 | MVP — CLI + MCP + dual storage | `specs/001-teamind-mvp/` |
| 002 | Retention & Enterprise — lifecycle, push, auth, RBAC | `specs/002-retention-enterprise/` |
| 003 | Search Intelligence & Growth | `specs/003-search-growth/` |
| 004 | Multi-Project — project-scoped isolation | `specs/004-multi-project/` |
| 005 | Registration API — zero-config hosted | `specs/005-registration-api/` |
| — | Community Edition — Docker Compose | `community/` |
| — | 3 Audit Rounds — 28 issues resolved | main branch |
