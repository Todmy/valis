# Tasks: Search Intelligence, Data Quality & Growth

**Input**: Design documents from `/specs/003-search-growth/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/*
**Extends**: Phase 2 (`/specs/002-retention-enterprise/tasks.md`)

**Organization**: Tasks grouped by phase (13 phases). 10 user stories (P1-P10), independently testable at each checkpoint.

## Format: `[ID] [P?] [US?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[US?]**: Which user story (US1-US10)
- Paths relative to repo root

## Path Conventions

- **CLI package**: `packages/cli/src/`, `packages/cli/test/`
- **Web package**: `packages/web/` (new)
- **Supabase**: `supabase/migrations/`, `supabase/functions/`
- **Edge Functions runtime**: Deno (esm.sh imports, not Node.js)

---

## Phase 1: Setup

**Purpose**: Schema migration 003, extended types, new module scaffolds

- [ ] T001 Extend types: Decision gains `pinned` (boolean), `enriched_by` ('llm' | 'manual' | null); update Organization.plan type from 'free'|'pro'|'enterprise' to 'free'|'team'|'business'|'enterprise'; LifecycleAction gains 'pin' | 'unpin'; AuditAction gains 'decision_pinned', 'decision_unpinned', 'decision_enriched', 'decision_auto_deduped', 'pattern_synthesized'; DecisionSource gains 'synthesis'; new Subscription, UsageOverage, EnrichmentUsage, PlanLimits, SignalWeights, RerankedResult, CleanupReport, EnrichmentResult, PatternCandidate types in `packages/cli/src/types.ts`
- [ ] T002 Create Postgres migration 003_search_growth.sql: ALTER decisions ADD pinned (boolean NOT NULL DEFAULT false), ADD enriched_by (text nullable CHECK in ('llm','manual')); DROP+ADD source CHECK to include 'synthesis'; also ALTER orgs.plan CHECK to include 'team','business' and UPDATE existing 'pro' rows to 'team'; CREATE subscriptions table with RLS; CREATE usage_overages table with RLS; CREATE enrichment_usage table with RLS; partial index on decisions.pinned; unique indexes on subscriptions; composite index on usage_overages(org_id, period_end); unique constraint on enrichment_usage(org_id, date, provider); RPC increment_enrichment_usage; RPC increment_usage_overage in `supabase/migrations/003_search_growth.sql`
- [ ] T003 [P] Scaffold empty module directories with barrel index.ts files: `packages/cli/src/search/`, `packages/cli/src/cleanup/`, `packages/cli/src/enrichment/`, `packages/cli/src/synthesis/`, `packages/cli/src/billing/`
- [ ] T004 [P] Add plan limit constants (PLAN_LIMITS, PLAN_PRICES, OVERAGE_RATES) per data-model.md in `packages/cli/src/billing/limits.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Search signals, reranker, and suppression modules — the core search intelligence pipeline that US5-US9 depend on

**CRITICAL**: Phases 5-9 cannot begin until this phase is complete

- [ ] T005 Implement individual signal computations: recencyDecay(createdAt, halfLifeDays) -> 0-1 exponential decay with pinned override; importance(confidence, pinned) -> 0-1 with 2x pin boost capped at 1.0; graphConnectivity(decisionId, allResults) -> 0-1 min-max normalized inbound depends_on count; normalizeBm25(scores) -> 0-1 min-max per contract in `packages/cli/src/search/signals.ts`
- [ ] T006 Implement multi-signal reranker: rerank(results, orgConfig) -> RerankedResult[] with composite_score from 5 weighted signals (semantic 0.30, bm25 0.20, recency 0.20, importance 0.15, graph 0.15); validate weights sum to 1.0; fallback to raw Qdrant score on total signal failure per contract in `packages/cli/src/search/reranker.ts`
- [ ] T007 Implement within-area suppression: suppressResults(results, threshold, includeAll) -> { visible, suppressed_count }; group by affects area; suppress below top when dominant (>1.5x); suppress below top-2 when non-dominant; cross-area results exempt; mark suppressed items per contract in `packages/cli/src/search/suppression.ts`
- [ ] T008 [P] Unit tests for signal computations: decay at 0/90/180 days, pinned override, importance with/without pin, graph connectivity normalization, BM25 normalization edge cases (all equal, empty) in `packages/cli/test/search/signals.test.ts`
- [ ] T009 [P] Unit tests for reranker: composite scoring with known weights, weight normalization, fallback on signal failure, result ordering in `packages/cli/test/search/reranker.test.ts`
- [ ] T010 [P] Unit tests for suppression: dominant result, non-dominant, cross-area exemption, empty affects, --all flag, suppressed_count accuracy in `packages/cli/test/search/suppression.test.ts`

**Checkpoint**: Search intelligence modules compile and pass unit tests. Reranking adds <10ms on 50 results.

---

## Phase 3: US1 — Proposed Status Workflow (Priority: P1)

**Goal**: Expose proposed status in search/dashboard, promote/deprecate workflow, push notifications for proposals

**Independent Test**: Store decision with `status: 'proposed'`. Search — see "proposed" label. Promote via lifecycle. Verify active with audit trail.

- [ ] T011 [US1] Extend teamind_store handler: validate `status: 'proposed'` as valid store option, ensure proposed decisions are visible in search results with proposed label in `packages/cli/src/mcp/tools/store.ts` (extend)
- [ ] T012 [US1] Extend teamind_lifecycle handler: extend existing promote action with explicit proposed→active audit trail and notification, add 'deprecate' for proposed decisions (proposed -> deprecated as rejection), create audit entries for both transitions in `packages/cli/src/mcp/tools/lifecycle.ts` (extend)
- [ ] T013 [US1] Extend teamind_search handler: include proposed decisions in results with status label, ensure proposed decisions appear in default search (not filtered out) in `packages/cli/src/mcp/tools/search.ts` (extend)
- [ ] T014 [US1] Extend dashboard command: add "Proposed (N)" section listing decisions awaiting review, show proposed count in summary stats in `packages/cli/src/commands/dashboard.ts` (extend)
- [ ] T015 [P] [US1] Extend Realtime push: trigger cross-session notification when a new proposed decision is stored, include proposed label in push event in `packages/cli/src/cloud/realtime.ts` (extend)

**Checkpoint**: Proposed workflow works end-to-end. Store proposed, search shows it, promote/deprecate via lifecycle, push notification sent.

---

## Phase 4: US2 — Cursor IDE Integration (Priority: P2)

**Goal**: Auto-detect Cursor, configure MCP settings and .cursorrules, idempotent init/uninstall

**Independent Test**: Run `teamind init` with Cursor installed. Verify MCP config created, .cursorrules has markers, MCP server works.

- [ ] T016 [US2] Implement Cursor IDE module: detect Cursor via `~/.cursor/` directory existence; configure MCP server in Cursor settings JSON; inject Teamind instruction markers (between delimiters) into `.cursorrules`; idempotent — no duplicate entries on re-run; follow same pattern as codex.ts in `packages/cli/src/ide/cursor.ts`
- [ ] T017 [US2] Extend IDE detection: add Cursor to detectInstalledIDEs() alongside Claude Code and Codex; return Cursor in detected list when `~/.cursor/` exists in `packages/cli/src/ide/detect.ts` (extend)
- [ ] T018 [US2] Extend init command: configure Cursor when detected, call cursor.ts configure function, log Cursor setup status in `packages/cli/src/commands/init.ts` (extend)
- [ ] T019 [US2] Extend uninstall command: clean up Cursor MCP config and remove .cursorrules markers when Cursor was configured in `packages/cli/src/commands/uninstall.ts` (extend)
- [ ] T020 [P] [US2] Unit tests for Cursor module: detection, config creation, .cursorrules injection, idempotency, cleanup on uninstall in `packages/cli/test/ide/cursor.test.ts`

**Checkpoint**: Cursor detected and configured by init. MCP server works with Cursor. Uninstall cleans up.

---

## Phase 5: US3 — Smart Dedup & Data Cleanup (Priority: P3)

**Goal**: Identify exact/near duplicates and stale orphans, auto-deprecate exact dupes, flag near-dupes for review

**Independent Test**: Store 5 near-duplicate decisions. Run `teamind admin cleanup --dry-run`. Verify duplicates identified.

- [ ] T021 [US3] Implement exact-duplicate detection: query decisions grouped by content_hash in same org with count > 1; keep newest; mark others for deprecation; respect protection rules (pinned never deprecated, decisions with inbound depends_on flagged for manual review instead) per cleanup contract in `packages/cli/src/cleanup/dedup.ts`
- [ ] T022 [US3] Implement near-duplicate detection: for each active decision, query Qdrant for similar points with cosine > 0.9 in same org; deduplicate symmetric pairs; return as flagged-for-review (NOT auto-deprecated) per cleanup contract in `packages/cli/src/cleanup/dedup.ts` (extend)
- [ ] T023 [US3] Implement stale orphan detection: query pending decisions older than 30 days; return as OrphanCandidate[] with age_days; flagged for review only per cleanup contract in `packages/cli/src/cleanup/orphans.ts`
- [ ] T024 [US3] Implement cleanup runner: orchestrate dedup + orphan detection; --dry-run reports without mutations; --apply auto-deprecates exact dupes + creates audit entries (decision_auto_deduped); return CleanupReport per contract in `packages/cli/src/cleanup/runner.ts`
- [ ] T025 [US3] Implement admin cleanup command: `teamind admin cleanup [--dry-run | --apply] [--org <org_id>]`; call cleanup runner; format report output with picocolors in `packages/cli/src/commands/admin-cleanup.ts`
- [ ] T026 [US3] Register admin cleanup command in CLI entry point in `packages/cli/bin/teamind.ts` (extend)
- [ ] T027 [P] [US3] Unit tests for dedup: exact hash match detection, near-duplicate flagging, protection rules (pinned, dependents), symmetric pair dedup in `packages/cli/test/cleanup/dedup.test.ts`
- [ ] T028 [P] [US3] Unit tests for orphan detection: stale pending identification, age calculation, empty result when no orphans in `packages/cli/test/cleanup/orphans.test.ts`

**Checkpoint**: Cleanup identifies exact dupes, near-dupes, stale orphans. --dry-run reports, --apply deprecates with audit.

---

## Phase 6: US4 — Web Dashboard (Priority: P4)

**Goal**: Read-only web dashboard with decisions, search, stats, contradictions, proposed queue

**Independent Test**: Open dashboard, enter API key, see decisions, search, view contradictions and stats. No write operations possible.

### Scaffold

- [ ] T029 [US4] Initialize packages/web: package.json with next, react, @supabase/supabase-js, tailwindcss; next.config.ts; tsconfig.json; tailwind.config.ts; environment variables for NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in `packages/web/`
- [ ] T030 [US4] Implement Supabase client factory: createAuthenticatedClient with JWT accessToken callback; auto-refresh before 1h expiry per web-dashboard contract in `packages/web/src/lib/supabase.ts`
- [ ] T031 [US4] Implement auth module: exchangeToken(apiKey) -> AuthSession; refreshToken; API key stored in sessionStorage; JWT in memory only per web-dashboard contract in `packages/web/src/lib/auth.ts`

### Components

- [ ] T032 [P] [US4] Implement auth-gate component: API key input form; call exchangeToken; redirect to /decisions on success; error display for invalid keys in `packages/web/src/components/auth-gate.tsx`
- [ ] T033 [P] [US4] Implement shared components: decision-card, search-bar, status-badge (active/proposed/deprecated/superseded), pin-badge, nav with Proposed (N) count badge in `packages/web/src/components/`
- [ ] T034 [P] [US4] Implement auth hooks: useAuth context hook for session management; protect all routes behind auth-gate in `packages/web/src/hooks/use-auth.ts`

### Pages

- [ ] T035 [US4] Implement root layout + landing page: layout.tsx with auth provider; page.tsx with auth-gate login form in `packages/web/src/app/`
- [ ] T036 [US4] Implement /decisions page: paginated list (20/page), filter by status/type/author/affects, sort by created_at/confidence, expand for full detail, read-only per contract in `packages/web/src/app/decisions/page.tsx`
- [ ] T037 [US4] Implement /search page: search bar with type-ahead, results with composite score + signal breakdown when available, suppressed toggle per contract in `packages/web/src/app/search/page.tsx`
- [ ] T038 [US4] Implement /dashboard page: total decisions sparkline, type/status breakdown, activity timeline from audit_entries, usage quota bars, proposed count link, contradictions count link per contract in `packages/web/src/app/dashboard/page.tsx`
- [ ] T039 [US4] Implement /contradictions page: open contradictions list, side-by-side decision pairs, overlap areas, similarity score, read-only per contract in `packages/web/src/app/contradictions/page.tsx`
- [ ] T040 [US4] Implement /proposed page: proposed decisions queue, summary/author/date/affects, count in nav badge, read-only per contract in `packages/web/src/app/proposed/page.tsx`

### Deployment

- [ ] T041 [US4] Configure Vercel deployment: vercel.json or project settings for packages/web; environment variable setup; build command `next build` in `packages/web/`

**Checkpoint**: Dashboard loads <3s. Auth via API key -> JWT. All pages render read-only. Tenant isolation enforced by RLS.

---

## Phase 7: US5 — Confidence Decay & Pinned Decisions (Priority: P5)

**Goal**: Decay signal reduces old decisions in ranking, pinned decisions exempt from decay, pin/unpin lifecycle actions

**Independent Test**: Store two decisions 90 days apart. Search — newer ranks higher. Pin older. Search — pinned at top.

**Depends on**: Phase 2 (signals.ts, reranker.ts)

- [ ] T042 [US5] Extend Qdrant client: add `pinned` field to payload on upsert; update payload on pin/unpin lifecycle action in `packages/cli/src/cloud/qdrant.ts` (extend)
- [ ] T043 [US5] Extend teamind_lifecycle handler: add 'pin' action (admin-only RBAC check, set pinned=true in Postgres + Qdrant, audit entry 'decision_pinned'); add 'unpin' action (admin-only, set pinned=false, audit entry 'decision_unpinned') in `packages/cli/src/mcp/tools/lifecycle.ts` (extend)
- [ ] T044 [US5] Extend MCP server: register pin/unpin as valid lifecycle actions in tool schema definition in `packages/cli/src/mcp/server.ts` (extend)
- [ ] T045 [US5] Extend dashboard command: show pinned decisions count, mark pinned decisions visually in `packages/cli/src/commands/dashboard.ts` (extend)

**Checkpoint**: Decay applied at search time. Pinned decisions immune. Pin/unpin admin-only with audit.

---

## Phase 8: US6 — Multi-Signal Reranking (Priority: P6)

**Goal**: Integrate reranker into search and context pipelines, replacing single-signal ranking

**Independent Test**: Store 10 decisions with varying ages/confidence/dependencies. Search — composite ordering, not just semantic.

**Depends on**: Phase 2 (reranker, signals), Phase 7 (pinned payload in Qdrant)

- [ ] T046 [US6] Integrate reranker into teamind_search: replace rankByStatus with rerank(); fetch 50 results from Qdrant; compute composite scores; sort by composite_score; include signal breakdown in response; slice to requested limit per search-reranking contract in `packages/cli/src/mcp/tools/search.ts` (extend)
- [ ] T047 [US6] Integrate reranker into teamind_context: apply reranking to context results for consistent ordering with search per contract in `packages/cli/src/mcp/tools/context.ts` (extend)
- [ ] T048 [P] [US6] Performance benchmark test: rerank 50 results in <10ms using performance.now() assertions in `packages/cli/test/search/reranker.test.ts` (extend)

**Checkpoint**: Search uses 5-signal composite score. <10ms overhead on 50 results. Signal values in response.

---

## Phase 9: US7 — Retrieval-Induced Suppression (Priority: P7)

**Goal**: Integrate suppression into search pipeline, add --all flag

**Independent Test**: Store 5 similar decisions in same area. Search — top 2 shown. --all shows all 5.

**Depends on**: Phase 8 (reranker integrated into search)

- [ ] T049 [US7] Integrate suppression into teamind_search: after reranking, call suppressResults(); return visible results + suppressed_count; support args.all flag to include suppressed with label per contract in `packages/cli/src/mcp/tools/search.ts` (extend)
- [ ] T050 [US7] Extend MCP search tool schema: add `all` boolean parameter for requesting full (unsuppressed) results in `packages/cli/src/mcp/server.ts` (extend)
- [ ] T051 [P] [US7] Integration test: 5 same-area decisions → default returns top 2, --all returns all 5 with suppressed labels in `packages/cli/test/search/suppression.test.ts` (extend)

**Checkpoint**: Suppression reduces noise 30-50%. --all flag bypasses. suppressed_count in response.

---

## Phase 10: US8 — LLM Enrichment Pipeline (Priority: P8)

**Goal**: Optional LLM classification of pending decisions with provider abstraction and cost ceiling

**Independent Test**: Store 5 pending decisions. Run `teamind enrich`. Verify type/summary/affects assigned. Works without LLM key.

- [ ] T052 [US8] Implement EnrichmentProvider interface and response parsing: EnrichmentResult type, parseEnrichmentResponse helper, ENRICHMENT_SYSTEM_PROMPT constant per cleanup-enrichment contract in `packages/cli/src/enrichment/provider.ts`
- [ ] T053 [US8] Implement Anthropic Haiku provider: AnthropicProvider implementing EnrichmentProvider; claude-3-5-haiku-latest model; estimatedCostPerToken per contract in `packages/cli/src/enrichment/anthropic.ts`
- [ ] T054 [P] [US8] Implement OpenAI GPT-4o-mini provider: OpenAIProvider implementing EnrichmentProvider; gpt-4o-mini model; estimatedCostPerToken per contract in `packages/cli/src/enrichment/openai.ts`
- [ ] T055 [US8] Implement daily cost ceiling tracker: checkCeiling(orgId, provider, ceilingCents) -> { allowed, spent, remaining }; increment_enrichment_usage RPC call after each enrichment per contract in `packages/cli/src/enrichment/cost-tracker.ts`
- [ ] T056 [US8] Implement enrichment runner: getProvider() with fallback; fetch pending decisions; dry-run mode; enrich loop with ceiling check; update Postgres (type, summary, affects, enriched_by='llm') + Qdrant payload; create audit entries (decision_enriched); no-LLM-key graceful exit per contract in `packages/cli/src/enrichment/runner.ts`
- [ ] T057 [US8] Implement enrich command: `teamind enrich [--dry-run] [--provider <anthropic|openai>] [--ceiling <dollars>]`; call enrichment runner; format report in `packages/cli/src/commands/enrich.ts`
- [ ] T058 [US8] Register enrich command in CLI entry point in `packages/cli/bin/teamind.ts` (extend)
- [ ] T059 [P] [US8] Unit tests for enrichment: provider interface mock, cost ceiling enforcement, no-LLM-key path, dry-run mode in `packages/cli/test/enrichment/provider.test.ts`
- [ ] T060 [P] [US8] Unit tests for cost tracker: ceiling reached, ceiling remaining, multi-provider per day in `packages/cli/test/enrichment/cost-tracker.test.ts`

**Checkpoint**: Enrichment classifies pending decisions. Cost ceiling enforced. No LLM key -> clean exit. Core ops unaffected.

---

## Phase 11: US9 — Pattern Synthesis (Priority: P9)

**Goal**: Detect decision clusters by area overlap, synthesize pattern decisions, idempotent

**Independent Test**: Store 5+ decisions with affects:["auth"]. Run `teamind admin patterns`. Verify pattern created.

- [ ] T061 [US9] Implement pattern detection: inverted index (area -> decision IDs); clusterByJaccard with 0.3 threshold; averagePairwiseJaccard cohesion; deduplicatePatterns for overlapping candidates per contract in `packages/cli/src/synthesis/patterns.ts`
- [ ] T062 [US9] Implement Jaccard similarity helper: jaccard(a, b) -> 0-1 intersection-over-union on string arrays per contract in `packages/cli/src/synthesis/patterns.ts` (extend)
- [ ] T063 [US9] Implement synthesis runner: detectPatterns(); idempotency check (existing pattern with >0.8 Jaccard overlap on depends_on skipped); createPattern via normal store pipeline with source='synthesis' + type='pattern'; deprecateStalePatterns (all source decisions deprecated -> auto-deprecate pattern); audit entries (pattern_synthesized); push notification via Realtime per contract in `packages/cli/src/synthesis/runner.ts`
- [ ] T064 [US9] Implement admin patterns command: `teamind admin patterns [--window <days>] [--min-cluster <n>] [--dry-run]`; call synthesis runner; format report in `packages/cli/src/commands/admin-patterns.ts`
- [ ] T065 [US9] Register admin patterns command in CLI entry point in `packages/cli/bin/teamind.ts` (extend)
- [ ] T066 [P] [US9] Unit tests for pattern detection: cluster identification, Jaccard similarity, idempotency, stale pattern deprecation in `packages/cli/test/synthesis/patterns.test.ts`

**Checkpoint**: Patterns detected from 3+ same-area decisions. Idempotent. Stale patterns auto-deprecated. Push sent.

---

## Phase 12: US10 — Usage-Based Pricing (Priority: P10)

**Goal**: Enforce plan limits, Stripe integration for upgrades, overage tracking, fail-open guarantee

**Independent Test**: Free tier org stores 501st decision -> blocked with upgrade message. Upgrade -> limit increases.

### Edge Functions

- [ ] T067 [US10] Implement check-usage Edge Function: extract org_id from JWT; query subscription + rate_limits; compare against PLAN_LIMITS; return allowed/denied/overage response; call incrementOverage for paid plans exceeding limits per billing contract in `supabase/functions/check-usage/index.ts`
- [ ] T068 [US10] Implement stripe-webhook Edge Function: verify Stripe signature; handle checkout.session.completed (upsert subscription), customer.subscription.updated (status sync), customer.subscription.deleted (downgrade to free), invoice.paid (mark overages billed), invoice.payment_failed (set past_due) per billing contract in `supabase/functions/stripe-webhook/index.ts`
- [ ] T069 [US10] Implement create-checkout Edge Function: get/create Stripe customer; create Checkout Session with plan metadata; return checkout_url per billing contract in `supabase/functions/create-checkout/index.ts`

### CLI Integration

- [ ] T070 [US10] Implement usage check helper: checkUsageOrProceed(orgId, operation) with 3s timeout, fail-open on any error (network, Edge Function error, timeout) per billing contract in `packages/cli/src/billing/usage.ts`
- [ ] T071 [US10] Integrate usage check into teamind_store: call checkUsageOrProceed before store; return blocked response with upgrade info when denied; proceed on allowed or error (fail-open) per contract in `packages/cli/src/mcp/tools/store.ts` (extend)
- [ ] T072 [US10] Integrate usage check into teamind_search: call checkUsageOrProceed before search; return empty results with upgrade message when denied; proceed on allowed or error (fail-open) per contract in `packages/cli/src/mcp/tools/search.ts` (extend)
- [ ] T073 [US10] Implement upgrade command: `teamind upgrade [--plan team|business] [--annual]`; call create-checkout; open Stripe Checkout URL in default browser in `packages/cli/src/commands/upgrade.ts`
- [ ] T074 [US10] Register upgrade command in CLI entry point in `packages/cli/bin/teamind.ts` (extend)
- [ ] T075 [P] [US10] Unit tests for billing limits: free tier block, paid overage tracking, enterprise unlimited, fail-open on error in `packages/cli/test/billing/limits.test.ts`

**Checkpoint**: Free tier limits enforced. Paid overages tracked. Stripe webhooks update subscription. Fail-open guaranteed.

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation, dashboard integration, documentation, publish prep

- [ ] T076 End-to-end flow test: store proposed -> search (see proposed) -> promote -> search (see active) -> pin -> search (pinned at top) -> store duplicates -> admin cleanup --dry-run -> admin cleanup --apply -> enrich pending -> admin patterns -> dashboard (stats, proposed, contradictions) -> web dashboard login + browse (manual validation per quickstart.md)
- [ ] T077 [P] Dashboard E2E test with Playwright: login with API key -> /decisions -> /search -> /dashboard -> /contradictions -> /proposed; verify read-only (no mutation buttons); verify tenant isolation in `packages/web/tests/`
- [ ] T078 [P] Golden test set for reranking: 50 query-result pairs with expected orderings; measure NDCG@10 improvement over single-signal baseline in `packages/cli/test/search/golden.test.ts`
- [ ] T079 [P] Extend dashboard command with Phase 3 additions: patterns section, usage metrics (decisions/searches used vs limit), enrichment stats in `packages/cli/src/commands/dashboard.ts` (extend)
- [ ] T080 [P] Update CLAUDE.md with Phase 3 technologies and project structure changes
- [ ] T081 Build and dry-run npm publish from packages/cli (verify new modules included, no missing deps, backward compatible)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 (T001 types) — BLOCKS Phases 7-9
- **Phase 3 (US1, P1)**: Depends on Phase 1 only — can start after Setup
- **Phase 4 (US2, P2)**: Depends on Phase 1 only — can parallel with Phase 3
- **Phase 5 (US3, P3)**: Depends on Phase 1 only — can parallel with Phases 3-4
- **Phase 6 (US4, P4)**: Depends on Phase 1 only — can parallel with Phases 3-5
- **Phase 7 (US5, P5)**: Depends on Phase 2 (signals.ts for decay computation)
- **Phase 8 (US6, P6)**: Depends on Phase 2 + Phase 7 (reranker + pinned in Qdrant)
- **Phase 9 (US7, P7)**: Depends on Phase 8 (suppression applied after reranking)
- **Phase 10 (US8, P8)**: Depends on Phase 1 only — can parallel with Phases 3-7
- **Phase 11 (US9, P9)**: Depends on Phase 1 only — can parallel with Phases 3-7
- **Phase 12 (US10, P10)**: Depends on Phase 1 (T001 types + T002 migration)
- **Phase 13 (Polish)**: Depends on all phases complete

### Dependency Graph

```
Phase 1 (Setup) ──┬── Phase 2 (Foundational) ── Phase 7 (Decay) ── Phase 8 (Reranking) ── Phase 9 (Suppression)
                   ├── Phase 3 (US1, Proposed) ─────────────────────────────────────────┐
                   ├── Phase 4 (US2, Cursor) ───────────────────────────────────────────┤
                   ├── Phase 5 (US3, Cleanup) ──────────────────────────────────────────┤
                   ├── Phase 6 (US4, Dashboard) ────────────────────────────────────────┼── Phase 13 (Polish)
                   ├── Phase 10 (US8, Enrichment) ──────────────────────────────────────┤
                   ├── Phase 11 (US9, Patterns) ────────────────────────────────────────┤
                   └── Phase 12 (US10, Billing) ── (needs Phase 2 for migration) ──────┘
```

### Parallel Opportunities

**After Phase 1 completes** (4 parallel tracks):
- Track A: Phase 2 (Foundational search) -> Phase 7 -> Phase 8 -> Phase 9
- Track B: Phase 3 (Proposed) + Phase 4 (Cursor) + Phase 5 (Cleanup)
- Track C: Phase 6 (Web Dashboard)
- Track D: Phase 10 (Enrichment) + Phase 11 (Patterns)

**Within phases** (tasks marked [P]):
- Phase 1: T003, T004 parallel with T001/T002
- Phase 2: T008, T009, T010 parallel (all test files)
- Phase 4: T020 parallel with T016-T019
- Phase 5: T027, T028 parallel (test files)
- Phase 6: T032, T033, T034 parallel (components/hooks)
- Phase 8: T048 parallel with T046-T047
- Phase 9: T051 parallel with T049-T050
- Phase 10: T053, T054 parallel (providers); T059, T060 parallel (tests)
- Phase 11: T066 parallel with T061-T065
- Phase 12: T075 parallel with T067-T074
- Phase 13: T077, T078, T079, T080 all parallel

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 3: US1 — Proposed Status Workflow (T011-T015)
3. **STOP and VALIDATE**: Proposed decisions store, search, promote/deprecate, push
4. This alone delivers: team decision-making process with review workflow

### Incremental Delivery

1. **Setup** (Phase 1) -> Foundation ready
2. **US1** (Phase 3, Proposed) -> Decision review workflow
3. **US2** (Phase 4, Cursor) -> Largest IDE audience captured
4. **US3** (Phase 5, Cleanup) -> Data quality, establishes batch job pattern
5. **US4** (Phase 6, Dashboard) -> Buyer persona conversion trigger
6. **Foundational** (Phase 2) -> Search intelligence modules ready
7. **US5** (Phase 7, Decay + Pinned) -> Relevance signal foundation
8. **US6** (Phase 8, Reranking) -> Intelligent search quality
9. **US7** (Phase 9, Suppression) -> Noise reduction
10. **US8** (Phase 10, Enrichment) -> Auto-captured content quality
11. **US9** (Phase 11, Patterns) -> Emergent insights (wow feature)
12. **US10** (Phase 12, Billing) -> Revenue infrastructure
13. **Polish** (Phase 13) -> E2E validation, publish prep

### Key Principles

- Each phase is independently testable at its checkpoint
- Commit after each task or logical group
- Stop at any checkpoint to validate — each phase adds value
- Backward compatibility: MVP + Phase 2 installations MUST work after Phase 3 deployment
- Billing never blocks core operations (fail-open)
- LLM enrichment never required for any core operation
- Web dashboard is read-only — no mutation path from browser

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [US?] label maps task to spec.md user story for traceability
- Task numbering T001-T081 (81 total tasks)
- All file paths reference plan.md project structure
- Edge Functions use Deno runtime with esm.sh imports (not Node.js)
- Web dashboard is a separate package (packages/web) with its own deps — does not affect CLI package
