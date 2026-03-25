# Teamind Product Backlog

Items not yet specified. Ordered by strategic priority.

## Current: Deploy + Dog Fooding

| # | Item | Status | Owner |
|---|------|--------|-------|
| 1 | Deploy Supabase (migrations 001-005 + 13 Edge Functions + env vars) | Not started | Dev |
| 2 | Set HOSTED_SUPABASE_URL + HOSTED_QDRANT_URL constants | Not started | Dev |
| 3 | npm link + test `teamind init` end-to-end | Not started | Dev |
| 4 | **Dog fooding on real project** (several weeks) | Not started | Todmy |

## Phase 4B: Go to Market (after dog fooding)

| # | Feature | Effort | Status | Notes |
|---|---------|--------|--------|-------|
| 5 | Billing integration (Stripe) | 3-5 days | Deferred | Code exists but untested. Deploy after dog fooding confirms product-market fit |
| 6 | Pricing page / website | 3-5 days | Not started | Needs domain (teamind.dev) |
| 7 | Annual prepay discount (20%) | 1-2 days | Not started | Depends on #5 (Stripe) |
| 8 | Device Authorization Grant (RFC 8628) for dashboard auth | 2-3 days | Not started | Better UX than API key entry |
| 9 | Vercel deploy web dashboard | 1 day | Not started | packages/web ready, needs Vercel project |

## Phase 5: Platform

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| 10 | **Task Marketplace** — project owners post tasks, external developers claim and execute them. Knowledge base controls which decisions the freelancer can see (via per-task access policy/prompt). KB validates submitted work against existing constraints. Simpler than Upwork — post task, wait for taker. Revenue: commission or premium. | Large | Idea |
| 11 | Selective Knowledge Sharing — per-task scoped access to decisions (subset of project knowledge). Owner defines a policy prompt: "share API conventions but not security architecture." | Medium | Idea (prerequisite for #10) |
| 12 | External member invites with task-scoped access | Medium | Idea (prerequisite for #10) |
| 13 | Validation pipeline — KB checks PR against existing decisions/constraints before merge | Medium | Idea |

## Infrastructure Optimization

| # | Item | Priority | Notes |
|---|------|----------|-------|
| 14 | **Analyze Edge Functions costs** — Supabase charges per execution time. Evaluate moving high-frequency EFs (check-usage, exchange-token) to Vercel Edge Functions where included in plan. Keep low-frequency EFs (register, create-project) on Supabase. | High | Do before scaling beyond beta |
| 15 | **Realtime push cost analysis** — Supabase Realtime has connection limits (200 free, 500 pro). Evaluate if this is sufficient for beta or if we need to optimize subscription fan-out. | Medium | Monitor during dog fooding |
| 16 | **Qdrant hosted mode** — currently CLI has empty qdrant_api_key in hosted mode. Search uses Qdrant via server-side seed EF but MCP search calls Qdrant directly (fails). Need: either expose Qdrant read-only key to hosted clients, or proxy search through an EF. | High | Blocks hosted mode search quality |

## Conversion Flows

| # | Item | Effort | Status |
|---|------|--------|--------|
| 17 | **Community → Hosted migration** — user running community Docker Compose wants to switch to hosted. Auto-migrate: export local Postgres data → import to Supabase hosted → update CLI config → verify. Must preserve all decisions, members, audit trail. | Medium | Backlog |
| 18 | **Hosted → Community migration** — user wants to self-host. Export from Supabase → import to local Docker Compose. | Medium | Backlog |

## Documentation Gaps

| # | Item | Priority |
|---|------|----------|
| 19 | **Community Edition spec** — formal spec for Docker Compose setup, direct SQL fallback, limitations vs hosted | Medium |
| 20 | **Audit decisions log** — document the 28 issues found across 3 audit rounds as architectural decision records (ADRs) | Medium |
| 21 | **Deploy runbook** — step-by-step for Supabase deploy (migrations, EFs, env vars, Qdrant) | High |

## Technical Debt

| # | Item | Priority |
|---|------|----------|
| 22 | Delete `export-cmd.ts` (command unregistered, file is dead code) | Low |
| 23 | Golden test set — 50 query-result pairs for reranking NDCG evaluation | Medium |
| 24 | E2E tests per quickstart.md for each phase | Medium |
| 25 | Hosted mode Qdrant verification endpoint (`/functions/v1/verify-qdrant`) | Low |
| 26 | `.gitignore` — add `.teamind.json` to prevent accidental commits | Low |
| 27 | `rate_limits` row creation — who inserts/increments daily counters? | Medium |

## Completed Phases

| Phase | Feature | Spec |
|-------|---------|------|
| 001 | MVP — CLI + MCP + dual storage | `specs/001-teamind-mvp/` |
| 002 | Retention & Enterprise — lifecycle, push, auth, RBAC | `specs/002-retention-enterprise/` |
| 003 | Search Intelligence & Growth — reranking, dashboard, enrichment, billing | `specs/003-search-growth/` |
| 004 | Multi-Project — project-scoped isolation | `specs/004-multi-project/` |
| 005 | Registration API — zero-config hosted onboarding | `specs/005-registration-api/` |
| — | Community Edition — Docker Compose self-hosted | `community/` |
| — | 3 Audit Rounds — 28 issues found and resolved | committed on main |
