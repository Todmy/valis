# Contract: Multi-Signal Search Reranking Pipeline

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-24
**Implements**: FR-007, FR-008, FR-009, FR-010, FR-011

## Overview

Replace the current single-signal ranking (Qdrant score + status
tiebreaker) with a 5-signal composite reranking pipeline. Add
post-reranking within-area suppression to reduce noise.

## Module Location

```
packages/cli/src/search/
├── reranker.ts          # Multi-signal reranking logic
├── suppression.ts       # Within-area result suppression
└── signals.ts           # Individual signal computation
```

## Input

```typescript
interface RerankInput {
  /** Raw results from Qdrant hybrid search. */
  results: SearchResult[];
  /** Org configuration for decay half-life and weights. */
  orgConfig: {
    halfLifeDays: number;       // Default: 90
    weights: SignalWeights;     // Default: equal weights
    suppressionThreshold: number; // Default: 1.5
  };
}
```

The reranker receives raw Qdrant results (already filtered by org_id,
type, and status via Qdrant filters). Each result includes:
- `id`, `score` (Qdrant dense vector score), `type`, `summary`,
  `detail`, `author`, `affects`, `created_at`, `status`
- `confidence` (from payload, nullable)
- `pinned` (from payload, boolean)
- `depends_on` (from payload, UUID array)

## Signals

### 1. Semantic Score (`semantic_score`)

- **Source**: Qdrant dense vector cosine similarity score.
- **Range**: 0.0 - 1.0 (already normalized by Qdrant).
- **Computation**: Direct from `result.score`.

### 2. BM25 Score (`bm25_score`)

- **Source**: Qdrant sparse vector BM25 score.
- **Range**: 0.0+ (raw BM25 scores are unbounded).
- **Normalization**: Min-max within result set → 0.0 - 1.0.
  If all scores are equal, normalize to 0.5.
- **Computation**: Requires prefetch query with sparse vector.
  If BM25 is unavailable (Qdrant config), defaults to 0.0 for
  all results and weight redistributed proportionally.

```typescript
// Qdrant query with prefetch for both dense and sparse
const results = await qdrant.query(COLLECTION_NAME, {
  prefetch: [
    { query: queryText, using: 'dense', limit: 50 },
    { query: { indices: bm25Indices, values: bm25Values }, using: 'bm25', limit: 50 },
  ],
  query: { fusion: 'rrf' },
  filter,
  limit: 50,
  with_payload: true,
});
```

### 3. Recency Decay (`recency_decay`)

- **Source**: Decision `created_at` timestamp.
- **Range**: 0.0 - 1.0 (exponential decay output).
- **Computation**:
  ```typescript
  function recencyDecay(createdAt: string, halfLifeDays: number): number {
    const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
    return Math.pow(0.5, ageDays / halfLifeDays);
  }
  ```
- **Pinned override**: If `pinned === true`, `recency_decay = 1.0`
  (no decay).

### 4. Importance (`importance`)

- **Source**: Decision `confidence` and `pinned` flag.
- **Range**: 0.0 - 1.0.
- **Computation**:
  ```typescript
  function importance(confidence: number | null, pinned: boolean): number {
    const base = confidence ?? 0.5;
    const boosted = pinned ? base * 2.0 : base;
    return Math.min(1.0, boosted);
  }
  ```
- **Interpretation**: A pinned decision with confidence 0.8 gets
  importance 1.0. An unpinned decision with confidence 0.5 gets 0.5.

### 5. Graph Connectivity (`graph_connectivity`)

- **Source**: Count of decisions that reference this decision in their
  `depends_on` array (inbound dependencies) + count of decisions this
  one `replaces` (outbound supersession).
- **Range**: 0.0 - 1.0 (normalized within result set).
- **Computation**:
  ```typescript
  function graphConnectivity(
    decisionId: string,
    allDecisions: SearchResult[],
  ): number {
    const inbound = allDecisions.filter(d =>
      d.depends_on?.includes(decisionId)
    ).length;
    // Normalize: min-max within result set
    return normalizeMinMax(inbound, allInboundCounts);
  }
  ```
- **Note**: For the initial result set (up to 50 items), we count
  inbound references within the result set. For a more complete
  count, a Postgres query would be needed — deferred to avoid
  latency. The within-set approximation is sufficient for ranking.

## Formula

```typescript
interface SignalWeights {
  semantic: number;
  bm25: number;
  recency: number;
  importance: number;
  graph: number;
}

const DEFAULT_WEIGHTS: SignalWeights = {
  semantic: 0.30,
  bm25: 0.20,
  recency: 0.20,
  importance: 0.15,
  graph: 0.15,
};

function compositeScore(
  signals: SignalValues,
  weights: SignalWeights,
): number {
  return (
    weights.semantic   * signals.semantic_score +
    weights.bm25       * signals.bm25_score +
    weights.recency    * signals.recency_decay +
    weights.importance * signals.importance +
    weights.graph      * signals.graph_connectivity
  );
}
```

**Constraint**: Sum of weights MUST equal 1.0. Validated at config
load time. If weights don't sum to 1.0, normalize them.

## Output

```typescript
interface RerankedResult extends SearchResult {
  /** Composite score from multi-signal reranking. */
  composite_score: number;
  /** Individual signal values for debugging/transparency. */
  signals: {
    semantic_score: number;
    bm25_score: number;
    recency_decay: number;
    importance: number;
    graph_connectivity: number;
  };
  /** Whether this result was suppressed (only present with --all). */
  suppressed?: boolean;
}

interface RerankedSearchResponse {
  results: RerankedResult[];
  /** Number of results suppressed from default view. */
  suppressed_count: number;
  offline?: boolean;
  note?: string;
}
```

## Suppression Algorithm

Post-reranking suppression reduces noise by hiding redundant results
within the same `affects` area.

```typescript
function suppressResults(
  results: RerankedResult[],
  threshold: number, // Default: 1.5
  includeAll: boolean, // --all flag
): { visible: RerankedResult[]; suppressed_count: number } {
  // 1. Group by affects area (a result may appear in multiple groups)
  const areaGroups = groupByAffectsArea(results);

  // 2. For each group, determine which results to suppress
  const suppressedIds = new Set<string>();
  for (const [area, group] of areaGroups) {
    if (group.length < 2) continue;

    const sorted = group.sort((a, b) => b.composite_score - a.composite_score);
    const topScore = sorted[0].composite_score;
    const secondScore = sorted[1].composite_score;

    if (topScore > threshold * secondScore) {
      // Dominant result — suppress all except top
      for (let i = 1; i < sorted.length; i++) {
        suppressedIds.add(sorted[i].id);
      }
    } else {
      // No dominant result — suppress below top 2
      for (let i = 2; i < sorted.length; i++) {
        suppressedIds.add(sorted[i].id);
      }
    }
  }

  // 3. A result is only truly suppressed if it is suppressed in ALL
  //    of its area groups. Cross-area results remain visible.
  const trulySuppressed = new Set<string>();
  for (const id of suppressedIds) {
    const result = results.find(r => r.id === id);
    if (!result) continue;

    const allGroupsSuppressed = result.affects.every(area => {
      const group = areaGroups.get(area);
      if (!group || group.length < 2) return false;
      // Check if this result would be suppressed in this group
      return suppressedIds.has(id);
    });

    if (allGroupsSuppressed) {
      trulySuppressed.add(id);
    }
  }

  // 4. Build output
  const visible = results.filter(r => {
    if (trulySuppressed.has(r.id)) {
      r.suppressed = true;
      return includeAll; // Include if --all flag
    }
    return true;
  });

  return {
    visible,
    suppressed_count: trulySuppressed.size,
  };
}
```

## Performance Budget

**Target**: Reranking adds <10ms overhead on 50 results (FR-010).

| Operation | Budget |
|-----------|--------|
| Signal computation (5 signals x 50 results) | <3ms |
| Score normalization | <1ms |
| Composite score calculation | <1ms |
| Suppression grouping + filtering | <2ms |
| Result sorting | <1ms |
| **Total** | **<8ms** |

All operations are in-memory on the already-fetched result set. No
additional database or Qdrant calls during reranking (graph connectivity
uses within-set approximation).

## Integration Point

The reranker is inserted into the existing search pipeline in
`packages/cli/src/mcp/tools/search.ts`:

```typescript
// Before (current):
const rawResults = await hybridSearch(qdrant, orgId, query, options);
const ranked = rankByStatus(enriched);

// After (Phase 3):
const rawResults = await hybridSearch(qdrant, orgId, query, { ...options, limit: 50 });
const reranked = rerank(rawResults, orgConfig);
const { visible, suppressed_count } = suppressResults(reranked, orgConfig.suppressionThreshold, args.all);
const finalResults = visible.slice(0, args.limit || 10);
```

The existing `rankByStatus` function is retired — its logic is
subsumed by the `importance` signal (active status contributes to
higher confidence, which feeds importance).

## Error Handling

- If any signal computation fails, default to 0.0 for that signal
  and log a warning. Reranking continues with remaining signals.
- If all signals fail, fall back to raw Qdrant score ordering
  (current behavior).
- If suppression encounters an empty affects array, skip that result
  for suppression (it cannot be grouped).

## Testing Strategy

- Unit tests for each signal computation function.
- Unit tests for composite scoring with known weights.
- Unit tests for suppression algorithm (dominant, non-dominant,
  cross-area, empty affects).
- Golden test set: 50 query-result pairs with expected orderings.
  Measure NDCG@10 improvement over current single-signal ranking.
- Performance benchmark: rerank 50 results in <10ms (Node.js
  `performance.now()` assertions).
