# Implementation Plan: Search Intelligence, Data Quality & Growth

**Branch**: `003-search-growth` | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-search-growth/spec.md`

## Summary

Extend the Valis platform with multi-signal search reranking (5
signals: semantic, BM25, recency decay, importance, graph connectivity),
within-area result suppression, data quality tooling (dedup, orphan
cleanup, LLM enrichment for pending decisions, pattern synthesis from
decision clusters), Cursor IDE integration, a read-only web dashboard
for non-CLI users, proposed decision workflow, and usage-based pricing
with Stripe integration. All changes are additive — backward compatible
with existing MVP and Phase 2 installations.

## Technical Context

**Language/Version**: TypeScript (ES2022, NodeNext module resolution), Node.js 20+
**Edge Functions Runtime**: Deno (Supabase Edge Functions). New functions: check-usage, stripe-webhook, create-checkout.
**Primary Dependencies**: Existing MVP + Phase 2 deps + `stripe` (Edge Functions only, Deno import). CLI: no new runtime deps. Web dashboard: `next`, `react`, `@supabase/supabase-js`, `tailwindcss`.
**Storage**: Supabase Postgres (extended schema, migration 003) + Qdrant Cloud (extended payload: `pinned` field) + Supabase Realtime (unchanged from Phase 2)
**Auth Model**: Unchanged from Phase 2. Per-member API keys -> JWT exchange. Web dashboard uses same exchange-token flow.
**Search Pipeline**: Existing single-signal Qdrant score replaced by 5-signal composite reranking computed client-side on fetched results. Post-reranking within-area suppression. <10ms overhead on 50 results.
**Data Quality**: Cleanup (dedup + orphans), LLM enrichment (optional, provider-abstracted, daily cost ceiling), pattern synthesis (pure area-overlap frequency, no LLM). All create audit entries.
**Web Dashboard**: Next.js on Vercel. Supabase client with JWT. Read-only — no mutations. Pages: decisions, search, dashboard stats, contradictions, proposed queue.
**Billing**: Stripe Checkout + Customer Portal (hosted). check-usage Edge Function before store/search. Fail-open: billing errors never block operations.
**Testing**: vitest for CLI modules. React Testing Library for dashboard components. Playwright for dashboard E2E. Golden test set (50 query-result pairs) for reranking NDCG evaluation.
**Target Platform**: macOS ARM64/Intel, Linux x64 (CLI, unchanged). Modern browsers (dashboard).
**Project Type**: CLI + MCP server (extended) + Web dashboard (new)
**Performance Goals**: <200ms search with reranking, <10ms reranking overhead on 50 results, <3s dashboard first load, <1s dashboard navigation
**Constraints**: Zero native deps (CLI), offline-capable (CLI), backward compatible with MVP + Phase 2, additive-only migrations, billing never blocks operations
**Scale/Scope**: Teams 3-50 devs, 500-25K decisions, 3 new Edge Functions, 1 new web package, 10+ new CLI modules, 10 user stories, 19 FRs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Cloud-First | PASS | Web dashboard is cloud-hosted. Billing via Stripe (cloud). Search reranking uses cloud-stored data. All new features cloud-native. |
| II | Minimally Invasive | PASS | Cursor integration follows same MCP + instruction marker pattern as Claude Code and Codex. No new IDE interception. Dashboard is a separate app, not injected into IDE. |
| III | Non-Blocking | PASS | Billing failures fail-open (FR-018). Enrichment is optional (FR-013). Suppression degrades to showing all results. Dashboard being down doesn't affect CLI. Decay is computed at search time, no background job required. |
| IV | No LLM Dependency for Core Ops | PASS | Store, search, context, lifecycle work without any LLM. Enrichment is strictly opt-in with API key (FR-012, FR-013). Pattern synthesis uses area overlap frequency, no LLM (FR-015). Reranking is pure math on existing signals. |
| V | Zero Native Dependencies | PASS | No new native deps in CLI package. Stripe SDK used only in Deno Edge Functions (not in npm package). Web dashboard is a separate package with its own deps. |
| VI | Auto-Capture by Default | PASS | Unchanged. Three capture layers preserved. Enrichment enhances auto-captured pending decisions but doesn't change capture mechanism. |
| VII | Dual Storage | PASS | Every write still goes to both Postgres and Qdrant. New `pinned` field replicated to Qdrant payload. Pattern decisions stored via normal dual-write pipeline. |
| VIII | Push + Pull | PASS | Pattern synthesis creates decisions via normal pipeline, triggering existing Realtime push. Proposed decisions trigger push notifications. No changes to push infrastructure. |
| IX | Decision Lifecycle | PASS | Proposed workflow adds promote/deprecate for proposed decisions. Pin/unpin actions extend lifecycle with audit trail. Cleanup creates audit entries for auto-dedup. Pattern synthesis stores decisions with `depends_on` links. |
| X | Identity-First Access | PASS | Web dashboard authenticates via API key -> JWT exchange (same as CLI). Pin action is admin-only. Dashboard queries enforced by JWT RLS. Billing actions require admin role. |

**Security & Data Integrity**: Web dashboard is read-only — no mutation path from browser. API key stored in sessionStorage only (cleared on tab close). JWT never persisted. Stripe webhook signature verification prevents spoofed events. Billing enforcement fails open — never blocks operations but never leaks billing data.

**Development Workflow**: Additive migration (003). Backward-compatible with migration 001 (MVP) and 002 (Retention). New web dashboard package added to monorepo. No changes to existing packages beyond additive extensions.

## Project Structure

### Documentation (this feature)

```text
specs/003-search-growth/
├── plan.md              # This file
├── research.md          # Phase 0: Decay, reranking, suppression, Cursor, dashboard, enrichment, synthesis, Stripe research
├── data-model.md        # Phase 1: Extended schema, new entities (subscription, usage_overages, enrichment_usage)
├── quickstart.md        # Phase 1: Validation checklist for all 10 user stories
├── contracts/
│   ├── search-reranking.md   # 5-signal reranking + suppression pipeline
│   ├── cleanup-enrichment.md # Dedup, orphans, LLM enrichment, pattern synthesis
│   ├── web-dashboard.md      # Dashboard pages, auth, read-only enforcement
│   └── billing.md            # check-usage, stripe-webhook, create-checkout Edge Functions
└── tasks.md             # Phase 2: /speckit.tasks output
```

### Source Code (repository root)

```text
packages/cli/src/
├── types.ts                    # Extended: Decision gains pinned, enriched_by; new Subscription, UsageOverage types; LifecycleAction gains pin/unpin; AuditAction gains new values; DecisionSource gains 'synthesis'
├── cloud/
│   ├── supabase.ts             # Extended: subscription queries, usage checks
│   ├── qdrant.ts               # Extended: pinned field in payload
│   └── realtime.ts             # Unchanged (Phase 2)
├── search/
│   ├── reranker.ts             # NEW: 5-signal composite reranking
│   ├── signals.ts              # NEW: Individual signal computation (decay, importance, graph)
│   └── suppression.ts          # NEW: Within-area result suppression
├── cleanup/
│   ├── dedup.ts                # NEW: Exact + near-duplicate detection
│   ├── orphans.ts              # NEW: Stale pending decision detection
│   └── runner.ts               # NEW: Cleanup orchestration
├── enrichment/
│   ├── provider.ts             # NEW: EnrichmentProvider interface
│   ├── anthropic.ts            # NEW: Anthropic Haiku implementation
│   ├── openai.ts               # NEW: OpenAI GPT-4o-mini implementation
│   ├── cost-tracker.ts         # NEW: Daily cost ceiling enforcement
│   └── runner.ts               # NEW: Enrichment orchestration
├── synthesis/
│   ├── patterns.ts             # NEW: Pattern detection (area overlap + Jaccard)
│   └── runner.ts               # NEW: Synthesis orchestration
├── billing/
│   ├── limits.ts               # NEW: Plan limit constants + check logic
│   └── usage.ts                # NEW: Usage tracking helpers
├── mcp/
│   ├── server.ts               # Extended: register pin/unpin lifecycle actions
│   └── tools/
│       ├── store.ts            # Extended: usage check before store
│       ├── search.ts           # Extended: reranking + suppression pipeline, usage check
│       ├── context.ts          # Extended: reranked results
│       └── lifecycle.ts        # Extended: pin/unpin actions
├── ide/
│   ├── cursor.ts               # NEW: Cursor MCP config + .cursorrules markers
│   ├── codex.ts                # Unchanged (reference pattern for cursor.ts)
│   └── detect.ts               # Extended: add Cursor detection
├── commands/
│   ├── serve.ts                # Unchanged
│   ├── init.ts                 # Extended: Cursor IDE configuration
│   ├── uninstall.ts            # Extended: Cursor cleanup
│   ├── dashboard.ts            # Extended: proposed count, patterns section, usage metrics
│   ├── admin-cleanup.ts        # NEW: valis admin cleanup command
│   ├── admin-patterns.ts       # NEW: valis admin patterns command
│   ├── enrich.ts               # NEW: valis enrich command
│   └── upgrade.ts              # NEW: valis upgrade command
├── auth/                       # Unchanged (Phase 2)
├── contradiction/              # Unchanged (Phase 2)
└── ...                         # Remaining MVP files unchanged

supabase/
├── migrations/
│   ├── 001_init.sql            # Unchanged (MVP)
│   ├── 002_retention.sql       # Unchanged (Phase 2)
│   └── 003_search_growth.sql   # NEW: pinned, enriched_by, source CHECK, subscriptions, usage_overages, enrichment_usage
├── functions/
│   ├── exchange-token/         # Unchanged (Phase 2)
│   ├── check-usage/            # NEW: usage limit check before store/search
│   ├── stripe-webhook/         # NEW: Stripe event handler
│   └── create-checkout/        # NEW: Stripe Checkout URL generation

packages/web/                   # NEW: Web dashboard
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx            # Landing/login
│   │   ├── decisions/page.tsx
│   │   ├── search/page.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── contradictions/page.tsx
│   │   └── proposed/page.tsx
│   ├── components/
│   ├── lib/
│   └── hooks/
└── tests/

packages/cli/test/
├── search/
│   ├── reranker.test.ts        # NEW: Reranking tests
│   ├── signals.test.ts         # NEW: Signal computation tests
│   └── suppression.test.ts     # NEW: Suppression tests
├── cleanup/
│   ├── dedup.test.ts           # NEW: Dedup detection tests
│   └── orphans.test.ts         # NEW: Orphan detection tests
├── enrichment/
│   ├── provider.test.ts        # NEW: Provider interface tests
│   └── cost-tracker.test.ts    # NEW: Cost ceiling tests
├── synthesis/
│   └── patterns.test.ts        # NEW: Pattern detection tests
├── billing/
│   └── limits.test.ts          # NEW: Plan limit tests
├── ide/
│   └── cursor.test.ts          # NEW: Cursor integration tests
└── ...                         # Existing tests unchanged
```

**Structure Decision**: Extends existing monorepo. CLI package gains
new modules (search, cleanup, enrichment, synthesis, billing). New
`packages/web` package for the dashboard. Edge Functions added
alongside existing ones. No restructuring of existing code.

## Complexity Tracking

> No Constitution Check violations. All 10 principles pass.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | -- | -- |

**Note on LLM enrichment (Principle IV)**: Enrichment uses LLM calls
but is strictly opt-in (requires explicit API key configuration),
independent from all core operations (FR-013), and has a daily cost
ceiling (FR-014). This satisfies the updated Principle IV wording:
"Enrichment features MAY use LLM optionally but MUST degrade
gracefully without it." No violation.

**Note on web dashboard (new technology surface)**: The dashboard is a
separate package (`packages/web`) with its own dependencies (Next.js,
React, Tailwind). These deps do not affect the CLI package — they are
isolated in the monorepo. The CLI's zero-native-deps guarantee
(Principle V) is preserved.
