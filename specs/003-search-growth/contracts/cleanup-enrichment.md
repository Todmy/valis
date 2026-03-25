# Contract: Cleanup, Enrichment & Pattern Synthesis

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-24
**Implements**: FR-003, FR-004, FR-012, FR-013, FR-014, FR-015, FR-019

## Overview

Three data quality operations: deduplication/cleanup, LLM enrichment
of pending decisions, and pattern synthesis from decision clusters.
All three share the same CLI admin command pattern, create audit
entries for every action, and support `--dry-run` mode.

## Module Locations

```
packages/cli/src/
├── cleanup/
│   ├── dedup.ts              # Near-duplicate detection + auto-dedup
│   ├── orphans.ts            # Stale orphan detection
│   └── runner.ts             # CLI command orchestration
├── enrichment/
│   ├── provider.ts           # EnrichmentProvider interface
│   ├── anthropic.ts          # Anthropic Haiku implementation
│   ├── openai.ts             # OpenAI GPT-4o-mini implementation
│   ├── cost-tracker.ts       # Daily cost ceiling enforcement
│   └── runner.ts             # CLI command orchestration
├── synthesis/
│   ├── patterns.ts           # Pattern detection algorithm
│   └── runner.ts             # CLI command orchestration
└── commands/
    ├── admin-cleanup.ts      # `valis admin cleanup` command
    ├── admin-patterns.ts     # `valis admin patterns` command
    └── enrich.ts             # `valis enrich` command
```

---

## 1. Dedup & Cleanup

### CLI Interface

```
valis admin cleanup [--dry-run | --apply] [--org <org_id>]
```

- `--dry-run` (default): Report what would be cleaned. No mutations.
- `--apply`: Execute cleanup actions. Creates audit entries.
- `--org`: Optional org filter for platform operators.

### Dedup Detection

```typescript
interface DedupCandidate {
  /** The decision to keep (newest by created_at). */
  keepId: string;
  /** The decisions to deprecate. */
  deprecateIds: string[];
  /** Detection method: 'exact_hash' or 'near_duplicate'. */
  method: 'exact_hash' | 'near_duplicate';
  /** Similarity score (1.0 for exact, 0.9+ for near). */
  similarity: number;
}
```

**Exact duplicates** (FR-004 — auto-deprecated):
```sql
SELECT content_hash, array_agg(id ORDER BY created_at DESC) AS ids
FROM decisions
WHERE org_id = $1 AND status = 'active'
GROUP BY content_hash
HAVING count(*) > 1;
```
Keep the newest (first in array). Deprecate the rest with
`status_reason: 'auto-dedup: exact content hash match'`.

**Near-duplicates** (FR-004 — flagged for review):
```typescript
async function findNearDuplicates(
  qdrant: QdrantClient,
  orgId: string,
  decisions: Decision[],
  threshold: number = 0.9,
): Promise<DedupCandidate[]> {
  const candidates: DedupCandidate[] = [];

  for (const decision of decisions) {
    // Search for similar decisions in Qdrant
    const similar = await qdrant.query(COLLECTION_NAME, {
      query: decision.id, // Use point ID for "recommend" style
      filter: {
        must: [
          { key: 'org_id', match: { value: orgId } },
          { key: 'status', match: { value: 'active' } },
        ],
        must_not: [
          { has_id: [decision.id] },
        ],
      },
      limit: 5,
      with_payload: true,
    });

    const nearDupes = similar.points
      .filter(p => (p.score ?? 0) > threshold)
      .map(p => ({
        id: p.id as string,
        score: p.score ?? 0,
      }));

    if (nearDupes.length > 0) {
      candidates.push({
        keepId: decision.id,
        deprecateIds: nearDupes.map(d => d.id),
        method: 'near_duplicate',
        similarity: nearDupes[0].score,
      });
    }
  }

  return deduplicateCandidates(candidates);
}
```

**Near-duplicates are NOT auto-deprecated.** They are reported in the
dry-run output and flagged for manual review. The report includes both
decision summaries for comparison.

### Orphan Detection

```typescript
interface OrphanCandidate {
  decisionId: string;
  summary: string | null;
  detail: string;
  createdAt: string;
  ageDays: number;
}
```

```sql
SELECT id, summary, detail, created_at,
       EXTRACT(DAY FROM now() - created_at) AS age_days
FROM decisions
WHERE org_id = $1
  AND type = 'pending'
  AND created_at < now() - INTERVAL '30 days';
```

Orphans are flagged in the report but not auto-deprecated. They
require manual review because pending decisions may still be useful
if the enrichment pipeline hasn't run yet.

### Cleanup Output

```typescript
interface CleanupReport {
  org_id: string;
  mode: 'dry_run' | 'applied';
  exact_duplicates: {
    groups: number;
    decisions_deprecated: number;
    details: DedupCandidate[];
  };
  near_duplicates: {
    pairs: number;
    details: DedupCandidate[];
  };
  stale_orphans: {
    count: number;
    details: OrphanCandidate[];
  };
  audit_entries_created: number;
}
```

### Audit Entries

For each auto-deprecated exact duplicate:
```typescript
{
  action: 'decision_auto_deduped',
  target_type: 'decision',
  target_id: deprecatedDecisionId,
  previous_state: { status: 'active' },
  new_state: { status: 'deprecated', status_reason: 'auto-dedup: exact content hash match' },
  reason: `Exact duplicate of ${keepId}`,
}
```

### Protection Rules

- Decisions with inbound `depends_on` references are NEVER
  auto-deprecated, even if they are exact duplicates. They are
  flagged for manual review instead.
- Pinned decisions are NEVER auto-deprecated.
- Only `active` decisions are candidates for dedup.

---

## 2. LLM Enrichment

### CLI Interface

```
valis enrich [--dry-run] [--provider <anthropic|openai>] [--ceiling <dollars>]
```

- `--dry-run`: Show what would be enriched. No mutations, no LLM calls.
- `--provider`: Override configured provider. Default from config.
- `--ceiling`: Override daily cost ceiling. Default: $1.00.

### Provider Interface

```typescript
interface EnrichmentResult {
  type: DecisionType;       // Classified type
  summary: string;          // Generated summary (max 200 chars)
  affects: string[];        // Extracted areas (max 10)
  tokensUsed: number;       // For cost tracking
}

interface EnrichmentProvider {
  name: string;
  enrich(text: string): Promise<EnrichmentResult>;
  estimatedCostPerToken: number; // In USD
}
```

### Anthropic Provider

```typescript
class AnthropicProvider implements EnrichmentProvider {
  name = 'anthropic';
  estimatedCostPerToken = 0.000001; // ~$0.001 per decision

  async enrich(text: string): Promise<EnrichmentResult> {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 300,
      system: ENRICHMENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    });
    return parseEnrichmentResponse(response);
  }
}
```

### OpenAI Provider

```typescript
class OpenAIProvider implements EnrichmentProvider {
  name = 'openai';
  estimatedCostPerToken = 0.0000006; // ~$0.001 per decision

  async enrich(text: string): Promise<EnrichmentResult> {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    });
    return parseEnrichmentResponse(response);
  }
}
```

### Enrichment System Prompt

```
You are a decision classifier for a software team's knowledge base.
Given raw text from a development session, classify it and extract
structured metadata.

Respond with valid JSON only:
{
  "type": "decision" | "constraint" | "pattern" | "lesson",
  "summary": "One-line summary (max 200 characters)",
  "affects": ["area1", "area2"] // 1-10 areas this decision affects
}

Rules:
- "decision": An explicit architectural or technical choice.
- "constraint": A limitation or requirement that restricts options.
- "pattern": A recurring approach or convention.
- "lesson": Something learned from experience (good or bad).
- Areas should be lowercase, hyphenated (e.g., "auth", "database",
  "api-design", "testing").
```

### Cost Ceiling Enforcement

```typescript
async function checkCeiling(
  orgId: string,
  provider: string,
  ceilingCents: number,
): Promise<{ allowed: boolean; spent: number; remaining: number }> {
  const { data } = await supabase
    .from('enrichment_usage')
    .select('cost_cents')
    .eq('org_id', orgId)
    .eq('date', today())
    .eq('provider', provider)
    .single();

  const spent = data?.cost_cents ?? 0;
  return {
    allowed: spent < ceilingCents,
    spent,
    remaining: Math.max(0, ceilingCents - spent),
  };
}
```

After each enrichment call, update the usage record:
```typescript
await supabase.rpc('increment_enrichment_usage', {
  p_org_id: orgId,
  p_date: today(),
  p_provider: provider,
  p_decisions: 1,
  p_tokens: result.tokensUsed,
  p_cost_cents: Math.ceil(result.tokensUsed * provider.estimatedCostPerToken * 100),
});
```

### Enrichment Pipeline

```typescript
async function runEnrichment(options: EnrichOptions): Promise<EnrichmentReport> {
  // 1. Check for provider configuration
  const provider = getProvider(options.provider);
  if (!provider) {
    return { error: 'No LLM provider configured. Pending decisions unchanged.' };
  }

  // 2. Fetch pending decisions
  const pending = await fetchPendingDecisions(orgId);
  if (pending.length === 0) {
    return { message: 'No pending decisions to enrich.', enriched: 0 };
  }

  // 3. Dry-run: report without changes
  if (options.dryRun) {
    return { mode: 'dry_run', candidates: pending.length, details: pending };
  }

  // 4. Enrich each decision (respecting ceiling)
  let enriched = 0;
  for (const decision of pending) {
    const ceiling = await checkCeiling(orgId, provider.name, options.ceilingCents);
    if (!ceiling.allowed) {
      return {
        message: `Daily cost ceiling reached ($${ceiling.spent / 100}). Resuming tomorrow.`,
        enriched,
        remaining: pending.length - enriched,
      };
    }

    const result = await provider.enrich(decision.detail);

    // 5. Update decision in Postgres
    await supabase.from('decisions').update({
      type: result.type,
      summary: result.summary,
      affects: result.affects,
      enriched_by: 'llm',
    }).eq('id', decision.id);

    // 6. Update Qdrant payload
    await qdrant.setPayload(COLLECTION_NAME, {
      payload: { type: result.type, summary: result.summary, affects: result.affects },
      points: [decision.id],
    });

    // 7. Create audit entry
    await createAuditEntry({
      action: 'decision_enriched',
      target_type: 'decision',
      target_id: decision.id,
      previous_state: { type: 'pending', summary: null, affects: [] },
      new_state: { type: result.type, summary: result.summary, affects: result.affects },
      reason: `Enriched by ${provider.name}`,
    });

    enriched++;
  }

  return { mode: 'applied', enriched, total: pending.length };
}
```

### No-LLM Guarantee (FR-013)

The enrichment module is completely isolated. It is imported only by
the `valis enrich` command. No core operation (store, search,
context, lifecycle) imports or calls any enrichment code. The
`EnrichmentProvider` interface is never referenced in the search or
store pipeline.

---

## 3. Pattern Synthesis

### CLI Interface

```
valis admin patterns [--window <days>] [--min-cluster <n>] [--dry-run]
```

- `--window`: Time window for clustering. Default: 30 days.
- `--min-cluster`: Minimum decisions per cluster. Default: 3.
- `--dry-run`: Report patterns without creating decisions.

### Pattern Detection Algorithm

```typescript
interface PatternCandidate {
  /** Unified affects areas for this cluster. */
  areas: string[];
  /** Decision IDs in the cluster. */
  decisionIds: string[];
  /** Jaccard similarity between cluster decisions (average pairwise). */
  cohesion: number;
  /** Suggested summary. */
  summary: string;
}

async function detectPatterns(
  orgId: string,
  windowDays: number,
  minCluster: number,
): Promise<PatternCandidate[]> {
  // 1. Fetch active decisions from the time window
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const decisions = await supabase
    .from('decisions')
    .select('id, affects, summary, type, created_at')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .gte('created_at', since);

  // 2. Build inverted index: area -> decision IDs
  const areaIndex = new Map<string, string[]>();
  for (const d of decisions.data ?? []) {
    for (const area of d.affects) {
      const ids = areaIndex.get(area) ?? [];
      ids.push(d.id);
      areaIndex.set(area, ids);
    }
  }

  // 3. Find areas with enough decisions
  const candidates: PatternCandidate[] = [];
  for (const [area, ids] of areaIndex) {
    if (ids.length < minCluster) continue;

    // 4. Cluster by Jaccard similarity on full affects arrays
    const clusterDecisions = ids.map(id =>
      decisions.data!.find(d => d.id === id)!
    );
    const clusters = clusterByJaccard(clusterDecisions, 0.3);

    for (const cluster of clusters) {
      if (cluster.length < minCluster) continue;

      const unionAreas = [...new Set(cluster.flatMap(d => d.affects))];
      const avgCohesion = averagePairwiseJaccard(cluster);

      candidates.push({
        areas: unionAreas,
        decisionIds: cluster.map(d => d.id),
        cohesion: avgCohesion,
        summary: `Team pattern: ${area} — ${cluster.length} decisions in ${windowDays} days`,
      });
    }
  }

  // 5. Deduplicate overlapping candidates
  return deduplicatePatterns(candidates);
}
```

### Jaccard Similarity

```typescript
function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
```

### Idempotency Check

Before creating a pattern, check if one already exists for this
cluster:

```sql
SELECT id FROM decisions
WHERE org_id = $1
  AND type = 'pattern'
  AND source = 'synthesis'
  AND status = 'active'
  AND affects && $2  -- overlapping areas
```

For each match, compute Jaccard between the existing pattern's
`depends_on` (source decisions) and the new cluster's decision IDs.
If overlap > 0.8, skip — pattern already exists.

### Pattern Creation

```typescript
async function createPattern(candidate: PatternCandidate): Promise<string> {
  const decision: StoreArgs = {
    text: candidate.summary,
    type: 'pattern',
    summary: candidate.summary,
    affects: candidate.areas,
    confidence: candidate.decisionIds.length / totalDecisionsInWindow,
    depends_on: candidate.decisionIds,
    status: 'active',
  };

  // Store via normal pipeline (Postgres + Qdrant)
  const result = await storeDecision(decision, {
    source: 'synthesis',
    author: 'system',
  });

  // Create audit entry
  await createAuditEntry({
    action: 'pattern_synthesized',
    target_type: 'decision',
    target_id: result.id,
    new_state: { areas: candidate.areas, source_count: candidate.decisionIds.length },
    reason: `Pattern detected: ${candidate.areas.join(', ')}`,
  });

  return result.id;
}
```

### Pattern Deprecation

When synthesis re-runs and all source decisions of an existing pattern
are deprecated, the pattern is auto-deprecated:

```typescript
async function deprecateStalePatterns(orgId: string): Promise<number> {
  const patterns = await supabase
    .from('decisions')
    .select('id, depends_on')
    .eq('org_id', orgId)
    .eq('type', 'pattern')
    .eq('source', 'synthesis')
    .eq('status', 'active');

  let deprecated = 0;
  for (const pattern of patterns.data ?? []) {
    const sources = await supabase
      .from('decisions')
      .select('id, status')
      .in('id', pattern.depends_on);

    const allDeprecated = (sources.data ?? []).every(
      s => s.status === 'deprecated' || s.status === 'superseded'
    );

    if (allDeprecated) {
      await deprecateDecision(pattern.id, 'All source decisions deprecated');
      deprecated++;
    }
  }
  return deprecated;
}
```

### Cross-Session Push

When a pattern is created, it triggers a Supabase Realtime INSERT
event on the `decisions` table, which is already subscribed to by
all active sessions (Phase 2 infrastructure). No additional push
mechanism is needed.

---

## Error Handling

All three operations follow the same pattern:
- Failures on individual decisions do not halt the batch.
- Each failure is logged with decision ID and error message.
- Final report includes success count, failure count, and details.
- Audit entries are only created for successful actions.

## Testing Strategy

- **Cleanup**: Unit tests with mock Supabase/Qdrant returning known
  duplicate sets. Verify exact dupes are auto-deprecated, near-dupes
  are flagged only, orphans are identified.
- **Enrichment**: Unit tests with mock provider returning known
  classifications. Verify cost ceiling enforcement (mock usage table).
  Verify no-LLM-key path returns clean message.
- **Synthesis**: Unit tests with known decision sets. Verify clusters
  of 3+ are detected. Verify idempotency (no duplicate patterns).
  Verify stale pattern deprecation.
