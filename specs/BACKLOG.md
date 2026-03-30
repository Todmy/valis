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
| 28 | **`valis login` — Device Authorization Grant (RFC 8628)** — browser-based login, token persistence in `~/.valis/credentials`, `valis init` skips registration if logged in, project selector from available memberships. Like `gh auth login`. | Medium | Idea |
| 30 | **Web Project Management** — `/projects/[id]` page with: member list, invite by email (auto-sends email notification), remove member, project settings. When invited user logs in, they automatically see the project. Requires: project detail page, POST /api/invite-member endpoint, email notification via Resend. | Medium | Next |
| 29 | **Knowledge Bases** — namespace layer inside projects (Org → Project → KB → Decisions). Each KB = separate context/topic (architecture, api-design, infrastructure, product). New table `knowledge_bases`, Qdrant `kb_id` payload field, CLI `valis switch --kb`, search scoped to active KB. Like GitHub repos within an org, but one level deeper. Interim: use `affected_areas` + type filters as lightweight KB proxy. | Large | Idea |

## Infrastructure: Email & Auth

| # | Item | Priority | Notes |
|---|------|----------|-------|
| 30 | ~~**Custom SMTP sender domain**~~ | ✅ Done | Configured via Resend (valis.krukit.co) + Supabase custom SMTP. Rate limit increased from 2/hr to 100/day. |

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

## Phase 6: Competitive Intelligence Ideas

Source: Analysis of MUSE (KnowledgeXLab), TRIBES (private project), Archgate, Grov, CodeScene, Greptile, mem0, Pieces. Date: 2026-03-30.

### Tier 1 — High impact, feasible now

| # | Feature | Inspired by | Effort | Notes |
|---|---------|-------------|--------|-------|
| 33 | **CI Enforcement** — GitHub Action that checks PRs against VALIS decisions. Takes `constraint` + `pattern` decisions for changed files, runs through Haiku: "does this diff violate any of these decisions?" Blocks merge with explanation. Turns VALIS from documentation tool into infrastructure tool. | Archgate (executable ADRs) | Medium | New API endpoint + GitHub Action. Builds on existing search API. Changes product category. |
| 34 | **PR Review Auto-Capture** — Webhook on PR review comments → Haiku extraction → decision objects automatically. "Don't use raw SQL here" becomes a `pattern` decision with zero friction. Higher signal-to-noise than session trace capture. | Greptile (learns from PRs) | Medium | GitHub webhook + extraction pipeline. Reuses existing Haiku enrichment. |
| 35 | **Drift Score** — Not binary contradiction but trend metric. "Last 2 weeks: 7 new decisions in area X deviate from pattern Y by 40%." Gives eng managers a reason to check dashboard weekly. | Grov (anti-drift) + CodeScene (temporal analysis) | Medium | New scoring algorithm on top of existing contradiction detection + relationship graph. |

### Tier 2 — Strong differentiators, more complex

| # | Feature | Inspired by | Effort | Notes |
|---|---------|-------------|--------|-------|
| 36 | **Knowledge Map** — Visual graph: which decisions are connected, who decided what, where knowledge concentrates. Bus factor per area. "Petro is the only one who understands auth layer. Bus factor = 1." Eng managers buy visibility, not documentation. | CodeScene (knowledge distribution maps, bus factor) | Large | Requires `decided_by` data + graph visualization in dashboard. |
| 37 | **Reflect Loop** — On auto-consolidation (SessionEnd → SessionStart spawn), don't just cluster — reflect: "what new decisions were made implicitly? any contradictions with existing?" Reflection produces structured experience, not raw log. | MUSE (Plan-Execute-Reflect-Memorize loop) | Medium | Extends existing Auto Dream pattern (#27). Haiku-powered reflection step. |
| 38 | **Cross-Project Transfer** — When new project created, VALIS proposes: "Project X has 5 relevant decisions for your stack. Import?" Accumulated experience generalizes to new tasks. Strong for consultancy teams starting new projects every 2-3 months. | MUSE (zero-shot improvement from accumulated experience) | Medium | Requires cross-project search + import/clone mechanism. Builds on multi-project (#004). |
| 42 | **Session Recording & Decision Provenance** — Capture structured agent session logs (tool calls, file reads, model responses, errors) via MCP hooks and link them to extracted decisions. Enables decision replay: "why was this decided?" → see full agent context at decision time. Gives audit trail, drift debugging, and reproducible decision context. No one in the market captures the decision *process*, only results. Think Chrome DevTools recording but for AI agent sessions. | AgentFS concept (SQLite-backed agent filesystem) | Large | New MCP hooks (SessionStart/Stop) + structured session storage. Builds on existing extraction pipeline. Unique competitive feature — no competitor has this. |

### Tier 3 — Inspiration, lower priority

| # | Feature | Inspired by | Effort | Notes |
|---|---------|-------------|--------|-------|
| 39 | **Proactive Context Push** — On `SessionStart`, VALIS analyzes working directory → injects top-5 relevant decisions into agent context. Don't wait for agent to query — push context proactively. | TRIBES concept (agents fail from lack of context, not coordination) | Medium | Claude Code hook or CLAUDE.md injection. MCP limitations apply. |
| 40 | **Hierarchical Decision Types** — Principle (never changes: "We're TypeScript-first") → Decision (rarely: "Use Zod for validation") → Implementation (often: "Zod schema for User"). Hierarchy affects search ranking — principles weigh more in conflict resolution. | MUSE (Strategic → Procedural → Tool memory hierarchy) | Medium | Schema change + ranking weight adjustments. |
| 41 | **Universal HTTP API** — REST API for non-MCP integrations: GitHub Copilot, Windsurf, any LLM tool. Broader TAM beyond Claude Code / Cursor. | mem0 (works with any LLM) | Large | Phase 3+. Win one niche first, then expand. |

### Explicitly rejected

| Idea | Source | Why not |
|------|--------|---------|
| OS-level capture (desktop app, 9-month rolling memory) | Pieces | Too noisy, privacy concerns, requires desktop app — not for solo founder |
| Agent-to-agent memory sharing (swarm infra) | TRIBES core concept | Different market. VALIS is for human teams, not agent swarms |
| Generic memory infrastructure (universal key-value) | mem0 | Race to bottom. VALIS wins through typed decisions, not generic storage |

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
