# Research: Search Intelligence, Data Quality & Growth

**Phase**: 0 — Outline & Research
**Date**: 2026-03-24

## Confidence Decay Function

**Decision**: Exponential decay with configurable half-life.

**Formula**:
```typescript
function decayScore(ageDays: number, halfLifeDays: number): number {
  return Math.pow(0.5, ageDays / halfLifeDays);
}

// Usage at search time:
const ageDays = (Date.now() - new Date(decision.created_at).getTime()) / 86_400_000;
const effectiveScore = baseScore * decayScore(ageDays, orgHalfLife ?? 90);
```

**Default half-life**: 90 days. Configurable per-org via org settings
(stored in `orgs` table or config).

**Behavior by age**:
| Age (days) | Decay multiplier (half-life=90) |
|-----------|-------------------------------|
| 0 | 1.000 |
| 30 | 0.794 |
| 90 | 0.500 |
| 180 | 0.250 |
| 365 | 0.062 |

**Pinned decisions**: Exempt from decay. `effectiveScore = baseScore`
when `decision.pinned === true`.

**Rationale**: Exponential decay is the standard model for information
relevance. The half-life parameter gives teams control — a fast-moving
startup might use 60 days, while a regulated enterprise might use 180.

**Alternatives considered**:
- **Linear decay** (`1 - age/maxAge`): Too aggressive — a 180-day-old
  decision has zero score. No gradual tail. Rejected because older
  decisions may still be relevant, just less so.
- **Logarithmic decay** (`1 / (1 + log(age))`): Too gradual — a
  365-day-old decision retains ~70% score. Fails to meaningfully
  differentiate old from new. Rejected because the whole point is to
  surface fresh decisions.
- **Step function** (full score for N days, then zero): Too abrupt.
  Binary cutoffs create confusing ranking jumps. Rejected.

**Computation**: Decay is computed at search time, not stored. This
avoids background recomputation and ensures scores are always current.
The `created_at` timestamp (already indexed) is the only input.

## Multi-Signal Reranking Weights

**Decision**: Weighted linear combination of 5 signals. Start with
equal weights; tune empirically via a golden test set.

**Signals and default weights**:

| Signal | Key | Default Weight | Range | Source |
|--------|-----|---------------|-------|--------|
| Semantic relevance | `semantic_score` | 0.30 | 0.0–1.0 | Qdrant dense vector score |
| BM25 keyword match | `bm25_score` | 0.20 | 0.0–1.0 | Qdrant sparse vector score |
| Recency (decay) | `recency_decay` | 0.20 | 0.0–1.0 | Exponential decay function |
| Importance | `importance` | 0.15 | 0.0–1.0 | `confidence * pin_boost` |
| Graph connectivity | `graph_connectivity` | 0.15 | 0.0–1.0 | Normalized dependency count |

**Formula**:
```typescript
composite_score =
  w.semantic   * normalize(semantic_score) +
  w.bm25       * normalize(bm25_score) +
  w.recency    * recency_decay +
  w.importance  * importance_score +
  w.graph      * graph_connectivity;
```

**Normalization**: Each signal is normalized to `[0.0, 1.0]` within the
result set. `recency_decay` is already in range. `importance_score` is
`(confidence ?? 0.5) * (pinned ? 2.0 : 1.0)`, clamped to `[0, 1]`.
`graph_connectivity` is `min(dependency_count / max_deps_in_set, 1.0)`.

**Tuning approach**: Build a golden test set of 50 query-result pairs
with human-ranked expected orderings. Score each weight configuration
against NDCG@10. Start with equal weights, grid-search in 0.05
increments. No ML — pure evaluation metrics.

**Rationale**: A weighted linear combination is interpretable,
debuggable, and fast. Each search result can report its signal breakdown
for transparency. No model training, no feature engineering pipeline.

**Alternatives considered**:
- **ML-based Learning to Rank** (LambdaMART, etc.): Requires labeled
  training data, model serving infrastructure, and ongoing retraining.
  Overkill for 5 signals. Rejected — violates simplicity principle.
- **RRF (Reciprocal Rank Fusion)**: Good for merging independent
  rankings but doesn't weight heterogeneous signals (recency, graph).
  Rejected — doesn't accommodate non-ranking signals.
- **Neural reranker (cross-encoder)**: High accuracy but adds LLM
  dependency and latency. Violates Constitution Principle IV. Rejected.

## Retrieval Suppression Strategy

**Decision**: Post-reranking, within-area suppression when a dominant
result exceeds 1.5x the second-best score in the same `affects` group.

**Algorithm**:
```
1. After reranking, group results by `affects` areas.
   A result may appear in multiple groups (one per affects entry).
2. For each area group with 2+ results:
   a. Sort by composite_score descending.
   b. If top_score > 1.5 * second_score:
      - Keep the top result.
      - Mark remaining results in this group as `suppressed: true`.
   c. If no dominant result, keep top 2, suppress the rest.
3. A result is suppressed only if it is suppressed in ALL of its area
   groups. Cross-area results (appearing in non-suppressed groups)
   remain visible.
4. Suppressed results are excluded from the default response but
   included when `--all` flag is set.
5. Response includes `suppressed_count` field.
```

**Threshold**: 1.5x score ratio. Configurable per-org (future).

**Rationale**: Within-area suppression targets redundancy (5 decisions
about "database choice") without hiding cross-domain results. The 1.5x
threshold ensures suppression only fires when there is a clear winner,
not when results are close.

**Alternatives considered**:
- **MMR (Maximal Marginal Relevance)**: Standard diversity algorithm
  but operates on embedding similarity, not area grouping. Would
  suppress semantically similar results across different areas.
  Rejected — we want area-aware suppression.
- **Global top-K cutoff**: Simple but doesn't account for area
  diversity. A query matching 3 areas should return top results from
  each, not just the global top 3. Rejected.
- **Clustering-based dedup**: K-means on embeddings, take centroid
  results. Adds complexity, nondeterministic, harder to explain to
  users. Rejected.

## Cursor MCP Configuration

**Decision**: Cursor uses `~/.cursor/mcp.json` for MCP server
registration. Project-level instructions go in `.cursorrules`.

**MCP Config** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "teamind": {
      "command": "teamind",
      "args": ["serve"]
    }
  }
}
```

**Instruction injection** (`.cursorrules`):
```
<!-- teamind:start -->
## Team Knowledge (Teamind)

Use `teamind_search` before making architectural decisions.
Use `teamind_store` when decisions are made.
Use `teamind_context` at the start of each task.
<!-- teamind:end -->
```

**Detection**: `~/.cursor/` directory existence.

**Uninstall**: Remove `teamind` key from `mcp.json`. Remove content
between `teamind:start` and `teamind:end` markers in `.cursorrules`.

**Implementation pattern**: Follows the existing `codex.ts` pattern
exactly. New file: `packages/cli/src/ide/cursor.ts` with
`configureCursorMCP()` and `injectCursorRulesMarkers()`.

**Rationale**: Cursor's MCP config format matches the same JSON
structure as Codex. The `.cursorrules` file is the Cursor equivalent
of Codex's `AGENTS.md` — project-level agent instructions.

**Alternatives considered**:
- **Global rules** (`~/.cursor/rules/teamind.md`): Global rules apply
  to all projects. Project-level `.cursorrules` is more appropriate
  since Teamind context is project-specific. Rejected as default, but
  could be added as option.
- **VS Code settings.json MCP**: Cursor also reads VS Code MCP config
  in `settings.json`. Using `mcp.json` is cleaner and avoids polluting
  VS Code settings. Rejected.

## Web Dashboard Stack

**Decision**: Next.js (React) deployed on Vercel. Supabase JS client
with JWT auth via `accessToken`. Read-only — no mutations.

**Architecture**:
```
Browser → Next.js (Vercel) → Supabase (via @supabase/supabase-js)
                                ↓
                           Postgres (RLS-enforced via JWT)
```

**Auth flow**:
1. User opens dashboard URL.
2. Enter member API key (or org API key).
3. Dashboard calls `POST /functions/v1/exchange-token` with the key.
4. Receives JWT + org metadata.
5. Creates Supabase client: `createClient(url, anonKey, { accessToken: () => jwt })`.
6. All queries go through Supabase client — RLS enforces tenant isolation.
7. JWT refreshed automatically before 1h expiry.

**Pages**:
| Route | Content |
|-------|---------|
| `/decisions` | Searchable list of all decisions with status labels, filters |
| `/search` | Full search interface matching CLI quality |
| `/dashboard` | Lifecycle stats, team activity timeline, usage metrics |
| `/contradictions` | Open contradictions with decision pairs and overlap areas |
| `/proposed` | Proposed decisions queue for review |

**Read-only enforcement**: The dashboard only uses `SELECT` queries and
existing RPC functions. No `INSERT`, `UPDATE`, or `DELETE` operations.
Mutation buttons (e.g., "Promote" on proposed decisions) are not
rendered — all mutations happen through CLI or MCP tools.

**Rationale**: Next.js is the standard React framework for Vercel
deployment. Supabase JS client with JWT is the exact same auth flow
the CLI uses — no new auth infrastructure. Read-only constraint keeps
the dashboard simple and avoids creating a second mutation path.

**Alternatives considered**:
- **SPA (Vite + React)**: Lighter but no SSR, no ISR, no API routes
  for token exchange. Rejected — Next.js provides more flexibility
  for future server-side features.
- **Astro**: Good for content sites, less suitable for interactive
  dashboards with real-time data. Rejected.
- **Custom backend + API**: Unnecessary — Supabase is the backend.
  Adding another API layer adds complexity without value. Rejected.
- **Retool / Appsmith**: Low-code dashboards. Fast to build but hard
  to customize, poor branding, and vendor lock-in. Rejected.

## LLM Enrichment Provider Abstraction

**Decision**: Interface-based abstraction with implementations for
Anthropic (Haiku) and OpenAI (GPT-4o-mini). Cost tracking per-org.

**Interface**:
```typescript
interface EnrichmentResult {
  type: DecisionType;       // Classified type
  summary: string;          // Generated summary
  affects: string[];        // Extracted areas
  tokensUsed: number;       // For cost tracking
}

interface EnrichmentProvider {
  name: string;
  enrich(text: string): Promise<EnrichmentResult>;
  costPerToken: number;     // For ceiling enforcement
}
```

**Implementations**:
- `AnthropicProvider`: Claude 3.5 Haiku. ~$0.001 per decision
  (est. 500 input + 200 output tokens).
- `OpenAIProvider`: GPT-4o-mini. ~$0.001 per decision (similar
  token economics).

**Provider selection**: Config-based. User sets `ENRICHMENT_PROVIDER`
env var or config field. No auto-detection — explicit opt-in per
Constitution Principle IV.

**Cost tracking**:
```typescript
interface EnrichmentUsage {
  org_id: string;
  date: string;          // YYYY-MM-DD
  provider: string;
  decisions_enriched: number;
  tokens_used: number;
  cost_cents: number;    // Accumulated daily cost in cents
}
```

Stored in Postgres. Daily ceiling check: if `cost_cents >= ceiling_cents`
for today, enrichment stops. Default ceiling: $1.00/day (100 cents).

**Rationale**: Two-provider support avoids vendor lock-in and gives
users flexibility. The interface pattern makes adding providers
trivial. Cost tracking is essential for the daily ceiling (FR-014).

**Alternatives considered**:
- **Single provider (Anthropic only)**: Simpler but excludes teams
  that only have OpenAI keys. Rejected.
- **Local models (Ollama)**: Attractive for privacy but requires
  local GPU, complex setup, inconsistent quality. Deferred to
  stretch goal.
- **No abstraction (direct API calls)**: Works for one provider but
  creates coupling. Adding a second provider means duplicating prompt
  logic. Rejected.

## Pattern Synthesis Algorithm

**Decision**: Area overlap frequency analysis. No LLM required.

**Algorithm**:
```
1. Query active decisions from the last N days (default: 30).
2. Build an inverted index: affects_area → [decision_ids].
3. For each area with 3+ decisions:
   a. Compute pairwise Jaccard similarity on full `affects` arrays.
   b. Group decisions with Jaccard > 0.3 (shared areas).
   c. If group size >= 3: pattern candidate.
4. For each candidate:
   a. Check if a pattern decision already exists for this area cluster
      (idempotency: match on `affects` set overlap > 0.8).
   b. If no existing pattern: create a new decision with:
      - type: 'pattern'
      - source: 'synthesis'
      - summary: "Team pattern: {area} — {count} decisions in {days} days"
      - affects: union of cluster affects
      - depends_on: list of source decision IDs
      - confidence: count / total_decisions_in_window (normalized)
5. Deprecated pattern cleanup: if all source decisions (depends_on)
   are deprecated, auto-deprecate the pattern.
```

**Jaccard similarity**:
```typescript
function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
```

**Rationale**: Pure frequency/area analysis satisfies Constitution
Principle IV (No LLM Dependency). Patterns are objectively derived
from decision clusters — no subjective interpretation needed. The
algorithm is deterministic, reproducible, and explainable.

**Alternatives considered**:
- **LLM-based synthesis**: Could generate richer summaries ("The team
  consistently chooses JWT for auth because...") but adds cost and
  hard dependency. Violates Principle IV. Rejected.
- **Embedding clustering** (DBSCAN on Qdrant vectors): Captures
  semantic similarity but is opaque — hard to explain why decisions
  were clustered. Area overlap is more interpretable. Rejected as
  primary approach, could enhance in future.
- **Manual tagging**: Requires user action. Auto-detection is the
  value proposition. Rejected.

## Stripe Integration Pattern

**Decision**: Stripe Checkout + Customer Portal (hosted). Webhook
handler as Supabase Edge Function. Async metering via `rate_limits`
table. No real-time blocking on billing failures.

**Architecture**:
```
CLI store/search → check-usage Edge Function → rate_limits table
                                                  ↓ (async)
Stripe Checkout ← upgrade URL ← check-usage (limit hit)
                                                  ↓
Stripe Webhook → stripe-webhook Edge Function → subscriptions table
                                                  ↓
Stripe Customer Portal ← admin billing link
```

**Stripe resources used**:
| Resource | Purpose |
|----------|---------|
| Checkout Sessions | Plan upgrade/purchase |
| Customer Portal | Self-service billing management |
| Subscriptions | Recurring billing |
| Usage Records | Overage metering (via Stripe Billing) |
| Webhooks | Async event handling |

**Webhook events handled**:
| Event | Action |
|-------|--------|
| `checkout.session.completed` | Create/update subscription record |
| `customer.subscription.updated` | Update plan, period dates |
| `customer.subscription.deleted` | Mark subscription cancelled |
| `invoice.paid` | Clear overage counters for period |
| `invoice.payment_failed` | Start grace period timer |

**Billing enforcement flow**:
1. Every `store` and `search` operation calls `check-usage` Edge Function.
2. Edge Function reads `rate_limits` for current period counts.
3. If within plan limits: proceed (no Stripe call).
4. If at limit (free tier): return upgrade message with Checkout URL.
5. If at limit (paid, overage enabled): proceed, increment overage counter.
6. Overage billed at period end via Stripe Usage Records.

**Non-blocking guarantee** (FR-018): If `check-usage` fails (network,
Stripe down, Edge Function error), the operation proceeds. Usage is
tracked locally in `rate_limits` and synced on next successful call.
Billing failures never block store or search.

**Rationale**: Stripe Checkout and Customer Portal eliminate custom
billing UI. Hosted pages handle PCI compliance, card management, and
receipts. Async metering via `rate_limits` ensures operations are
never blocked by billing infrastructure.

**Alternatives considered**:
- **Custom billing UI**: Full control but PCI compliance burden,
  card form security, receipt generation. Rejected — Stripe hosted
  pages handle all of this.
- **Paddle / Lemon Squeezy**: Simpler than Stripe for SaaS but less
  flexibility for usage-based pricing. Rejected — Stripe's Usage
  Records API is purpose-built for metering.
- **Synchronous billing check**: Block operations when Stripe is
  unreachable. Violates FR-018 and Constitution Principle III
  (Non-Blocking). Rejected.
