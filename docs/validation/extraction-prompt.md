# Valis Inline Haiku Extraction — Full Problem Analysis

**Date:** 2026-03-17
**Status:** Pre-implementation analysis
**Architecture under review:** Agent calls `valis_store({text})` → MCP server stores raw in SQLite (<10ms) → calls Haiku API inline → updates SQLite → returns structured result

---

## Problem 1: Haiku API Latency Variance

### The Claim: "500ms-1.5s total time"

This is **optimistic for the happy path and dangerously wrong for tail latency.**

**Real latency data (from benchmarks and Anthropic docs):**

| Model | Metric | Value | Source |
|-------|--------|-------|--------|
| Haiku 4.5 (Anthropic direct) | TTFT P50 | ~600ms | kunalganglani.com/blog/llm-api-latency-benchmarks-2026 |
| Haiku 4.5 (Anthropic direct) | TTFT P95 | ~612ms | Same (remarkably consistent) |
| Haiku 4.5 (Anthropic direct) | Total latency (full response) | ~3,954ms | Same (for ~500 token output) |
| Haiku 4.5 (AWS Bedrock) | TTFT P50 | ~0.8-1.0s | artificialanalysis.ai |
| Haiku 4.5 (Azure) | TTFT | ~1.03s | artificialanalysis.ai |
| Haiku 4.5 (Google Vertex) | TTFT | ~1.38s | artificialanalysis.ai |
| Haiku 4.5 | Output speed (Anthropic) | ~82 t/s | artificialanalysis.ai |
| Haiku 4.5 | Output speed (AWS) | ~100 t/s | artificialanalysis.ai |
| Haiku 3.5 (Anthropic) | TTFT P50 | ~1.1s | artificialanalysis.ai (slower than 4.5) |

**Calculating actual extraction latency for Valis:**

Our extraction output is ~150-250 tokens of JSON. At 82 tokens/sec (Anthropic direct):

```
Total = TTFT + (output_tokens / speed)
P50   = 600ms + (200 / 82 * 1000) = 600 + 2439 = ~3,039ms ≈ 3.0s
P95   = 612ms + (200 / 82 * 1000) = ~3,051ms ≈ 3.1s  (TTFT is consistent)
```

But that's for 200 output tokens at median. Real variance comes from:
- API cold starts / capacity spikes (adds 1-5s in rare cases)
- Network jitter (user's location to Anthropic servers)
- Anthropic infrastructure load (holiday traffic, product launches)

**Realistic latency envelope:**

| Scenario | Latency | Frequency |
|----------|---------|-----------|
| P50 (typical) | 2.5-3.5s | 50% of calls |
| P90 | 3.5-5s | ~40% |
| P95 | 5-8s | ~5% |
| P99 (spike/cold) | 8-15s | ~1% |
| Timeout/failure | >30s | <0.5% |

### Impact on MCP Tool Response Time

The MCP tool call `valis_store` is **synchronous from the agent's perspective.** The agent sends a tool call, waits for the response, then continues. If extraction takes 3s:

- Agent is **blocked for 3 seconds** every time it stores a decision
- In a typical Claude Code session, agent makes 2-5 store calls
- That's **6-15 seconds of dead time** per session just for storing decisions
- Agent's per-tool timeout is typically 30-60s — safe, but 3s feels slow to the user

### VERDICT: 500ms is fiction. Expect 2.5-3.5s typical, 5-8s at P95.

### Mitigation Options

1. **Store-then-enrich (async):** Return raw text immediately to agent (<10ms), enrich with Haiku in background. Agent gets a provisional result, Haiku updates async.
2. **Prompt caching:** Cache the system prompt (saves ~200 input tokens). At 0.1x cost and faster processing, this helps but doesn't change output generation time.
3. **Use Haiku 3 instead of 4.5:** Haiku 3 is $0.25/$1.25 per MTok (4x cheaper) and was faster for small tasks historically. But it's deprecated.
4. **Streaming response:** Stream Haiku output and return partial result. Not useful for JSON extraction — need complete JSON.

---

## Problem 2: Haiku API Failures

### Error Types and Their Frequency

| HTTP Code | Meaning | Typical Frequency | Impact |
|-----------|---------|-------------------|--------|
| 429 | Rate limit exceeded | Common at Tier 1-2 | Request rejected, retry after N seconds |
| 500 | Internal server error | Rare (<0.1%) | Retry with backoff |
| 503 | Overloaded | Occasional during peaks | Retry after 30-60s |
| 529 | Overloaded (Anthropic-specific) | Occasional | Same as 503 |
| Timeout | No response in N seconds | Rare (<0.5%) | Retry or give up |

### Rate Limit Reality (using USER'S API key)

Valis uses the user's own Anthropic API key. Their rate limits depend on their tier:

| Tier | Deposit | Haiku 4.5 RPM | Haiku 4.5 ITPM | Haiku 4.5 OTPM |
|------|---------|---------------|----------------|----------------|
| 1 | $5 | 50 | 50,000 | 10,000 |
| 2 | $40 | 1,000 | 450,000 | 90,000 |
| 3 | $200 | 2,000 | 1,000,000 | 200,000 |
| 4 | $400 | 4,000 | 4,000,000 | 800,000 |

**Critical problem:** A Tier 1 user (just started, $5 deposit) gets **50 RPM for Haiku.** That sounds fine — 50 extractions per minute. But this limit is **SHARED** across everything they use Haiku for. If they're already using Haiku in their Claude Code workflow or other tools, Valis's extraction calls compete for the same quota.

**Worse:** Many users are Tier 1. The typical early adopter who just signed up for Anthropic API is Tier 1. This is exactly our target demographic during launch.

### What Happens on Failure?

Current architecture has **no defined failure path.** The spec says:

```
Agent calls valis_store → MCP server → Haiku classifies → returns structured result
```

If Haiku fails, current prototype (`mcp-prototype.js`) does NOT call Haiku at all — it uses a heuristic (first sentence = summary). The gap between prototype and spec is the entire extraction pipeline.

**Required failure handling (not specified in design):**

```
Agent calls valis_store({text: "..."})
  → SQLite INSERT (raw text, type='unclassified') [<10ms, always succeeds]
  → Try Haiku extraction
    → 200 OK: UPDATE SQLite with structured fields, return enriched result
    → 429: Return raw result + flag "enrichment_pending: true", queue retry
    → 500/503/529: Same as 429
    → Timeout (>10s): Same as 429
    → Malformed JSON from Haiku: Return raw, log error, no retry
  → Return result to agent
```

**The agent sees different return shapes depending on Haiku success/failure.** This creates a branching problem — does the agent's CLAUDE.md instruction handle both cases? It shouldn't need to. The MCP server should always return a consistent shape.

### VERDICT: Need a clear degraded-mode path. Raw storage must always succeed. Enrichment failures must be silent from the agent's perspective.

---

## Problem 3: Cost of search_keywords Generation

### Token Accounting for "Generate 10-15 Search Keywords"

Adding `search_keywords` to the extraction prompt increases output by approximately:

```json
"search_keywords": ["postgres", "postgresql", "database", "rdbms", "acid",
  "transactions", "payment", "financial", "data-store", "sql",
  "relational-database", "payment-processing", "data-integrity"]
```

That's ~50-70 additional output tokens per extraction.

### Cost Impact

**Without keywords (baseline):**
- Input: ~350 tokens (system prompt + user text)
- Output: ~120 tokens (type, summary, detail, affects, confidence)
- Cost per extraction: (350 * $1/1M) + (120 * $5/1M) = $0.00035 + $0.0006 = **$0.00095**

**With keywords (+60 output tokens):**
- Input: ~380 tokens (slightly longer prompt to ask for keywords)
- Output: ~180 tokens
- Cost per extraction: (380 * $1/1M) + (180 * $5/1M) = $0.00038 + $0.0009 = **$0.00128**

**Difference:** $0.00033 per extraction → **35% increase in cost per extraction.**

At 1000 extractions/month: $0.95 → $1.28 (extra $0.33/month). Negligible.
At 10,000 extractions/month: $9.50 → $12.80 (extra $3.30/month). Still negligible.

### But Is It Worth It?

**The real question: does Valis even need LLM-generated keywords?**

FTS5 already does stemming and keyword matching on `summary` + `detail` + `affects`. If someone searches "PostgreSQL", FTS5 will find it in the `detail` field. Keywords add value ONLY for:

1. **Synonyms** that don't appear in the text ("rdbms" when text says "PostgreSQL")
2. **Related concepts** ("acid-transactions" when text only says "need ACID")
3. **Abbreviations** ("pg" for PostgreSQL, "k8s" for Kubernetes)

This is genuinely useful for search quality. But it's the kind of thing that matters at scale (>500 decisions) and can be added later without breaking anything.

### VERDICT: Keywords add 35% to extraction cost ($0.33/month at typical volume). Worth including from day 1 because the marginal cost is near-zero and search quality improvement is real. But if cutting scope for MVP, this is the first thing to defer.

---

## Problem 4: Classification Prompt Quality

### THE ACTUAL EXTRACTION PROMPT

This is the core IP. Here's the prompt that Haiku would receive:

```
<system>
You classify engineering knowledge into structured objects.

INPUT: Raw text from a developer or AI agent about a technical decision, constraint, pattern, or lesson learned.

OUTPUT: A single JSON object. No markdown, no explanation, just valid JSON.

TYPES:
- "decision": A deliberate choice between alternatives. MUST have alternatives considered or reasoning for the choice. "We chose X" alone is not enough — need "because Y" or "instead of Z".
- "constraint": An external limitation or requirement imposed on the project. Not a choice — a given. Client requirements, regulatory needs, infrastructure limits, compatibility requirements.
- "pattern": A recurring approach, convention, or standard the team follows. Coding conventions, API design patterns, naming rules, architecture patterns that are ESTABLISHED (not proposed).
- "lesson": Something learned from experience — a bug, incident, performance issue, failed approach. Includes the WHAT WENT WRONG and WHY/HOW it was fixed.

CONFIDENCE SCORING:
- 9-10: Explicit, unambiguous statement with reasoning ("We decided X because Y")
- 7-8: Clear statement but reasoning partially implied ("Using X for this service")
- 5-6: Implied or inferred from context, some ambiguity
- 3-4: Weak signal, might be discussion rather than decision
- 1-2: Very uncertain, likely noise

REJECTION RULES — return {"skip": true, "reason": "..."} for:
- Trivial changes (typo fixes, formatting, import reordering)
- Discussion/brainstorming without resolution ("maybe we should...", "what if we...")
- Questions without answers ("should we use X?")
- Status updates ("deployed to staging", "merged PR")
- Empty or garbage input

OUTPUT SCHEMA:
{
  "type": "decision" | "constraint" | "pattern" | "lesson",
  "summary": "One-line description, max 100 chars, starts with verb or noun",
  "detail": "Full context: what, why, alternatives considered if any",
  "affects": ["module-name", "service-name"],
  "confidence": 1-10,
  "search_keywords": ["keyword1", "keyword2", "...up to 12 keywords including synonyms and abbreviations"]
}

Or if rejected:
{
  "skip": true,
  "reason": "Brief reason for rejection"
}
</system>

<user>
Classify this engineering knowledge:

{USER_TEXT}
</user>
```

### Test Cases and Expected Results

**Test 1:** "We decided to use PostgreSQL because we need ACID transactions"
```json
{
  "type": "decision",
  "summary": "Use PostgreSQL for ACID transaction requirements",
  "detail": "PostgreSQL chosen because the project requires ACID transactions. No alternative databases mentioned but the 'because' framing implies others were considered and rejected for lacking ACID compliance.",
  "affects": ["database"],
  "confidence": 8,
  "search_keywords": ["postgresql", "postgres", "acid", "transactions", "database", "rdbms", "sql", "data-integrity", "relational"]
}
```
**Prediction: Haiku handles this correctly 95%+ of the time.** Clear decision with reasoning.

---

**Test 2:** "Client requires Safari 15+ support"
```json
{
  "type": "constraint",
  "summary": "Safari 15+ browser support required by client",
  "detail": "External client requirement mandating Safari version 15 or higher support. This is a compatibility constraint that affects frontend technology and CSS/JS feature choices.",
  "affects": ["frontend"],
  "confidence": 9,
  "search_keywords": ["safari", "browser-support", "compatibility", "client-requirement", "webkit", "css", "frontend", "browser-compat"]
}
```
**Prediction: Haiku handles this correctly 90%+ of the time.** The word "requires" clearly signals constraint, not decision.

---

**Test 3:** "All API endpoints follow /api/v1/{resource} convention"
```json
{
  "type": "pattern",
  "summary": "API endpoints follow /api/v1/{resource} URL convention",
  "detail": "Established naming convention for all API endpoints using versioned resource-based URLs: /api/v1/{resource}. This is a team-wide standard.",
  "affects": ["api-gateway", "backend"],
  "confidence": 8,
  "search_keywords": ["api", "rest", "url-pattern", "endpoint", "routing", "convention", "versioning", "resource-naming", "api-design"]
}
```
**Prediction: Haiku handles this correctly 85% of the time.** Risk: Haiku might classify as "decision" (someone decided this convention) rather than "pattern" (it's an ongoing standard). Both are defensible. The prompt's distinction needs to be clear: pattern = ESTABLISHED standard, decision = specific choice at a point in time.

---

**Test 4:** "N+1 query caused timeout in OrderService, fixed with eager loading"
```json
{
  "type": "lesson",
  "summary": "N+1 query caused timeout in OrderService; fixed with eager loading",
  "detail": "Performance issue: N+1 query pattern in OrderService caused request timeouts. Root cause was lazy loading of related entities. Fixed by switching to eager loading. Lesson: watch for N+1 patterns in ORM queries, especially in services with nested entity relationships.",
  "affects": ["order-service"],
  "confidence": 9,
  "search_keywords": ["n+1", "query", "performance", "timeout", "eager-loading", "lazy-loading", "orm", "database", "optimization", "order-service"]
}
```
**Prediction: Haiku handles this correctly 95%+ of the time.** Classic bug/fix pattern, very clear.

---

**Test 5:** "Maybe we should consider using GraphQL"
```json
{
  "skip": true,
  "reason": "Discussion/brainstorming without resolution — no decision made"
}
```
**Prediction: Haiku correctly rejects 70-80% of the time.** This is the hardest case. "Maybe we should" is clearly tentative, but Haiku has a tendency to over-extract rather than skip. Some models treat any technical mention as worth classifying. The word "maybe" and "consider" should trigger rejection per our rules, but smaller models sometimes miss the nuance.

**Risk mitigation:** Add explicit examples of rejection cases in the system prompt. Few-shot helps enormously here.

---

**Test 6:** "Fixed typo in README"
```json
{
  "skip": true,
  "reason": "Trivial change — typo fix"
}
```
**Prediction: Haiku correctly rejects 95%+ of the time.** "Typo" + "README" are strong negative signals.

---

### Overall Classification Accuracy Estimate

| Input Type | Expected Accuracy | Risk |
|------------|------------------|------|
| Clear decision with reasoning | 95%+ | Low |
| Clear constraint | 90%+ | Low |
| Pattern vs decision boundary | 80-85% | Medium — these overlap |
| Lesson/bug report | 95%+ | Low |
| Rejection of discussion/brainstorming | 70-80% | HIGH — over-extraction tendency |
| Rejection of trivial changes | 95%+ | Low |

**Aggregate precision estimate: 82-88%** which exceeds the 60% Go/No-Go threshold from extraction-quality-test.md.

**The failure mode is NOT wrong classification — it's over-extraction (false positives).** Haiku is more likely to classify something that should be skipped than to misclassify a real decision.

---

## Problem 5: Garbage Input Handling

### Scenario: `valis_store({text: "asdfasdf"})`

**What happens now (prototype):** Stores "asdfasdf" as summary, with type='decision'. No validation.

**What Haiku would do:** Return a rejection:
```json
{"skip": true, "reason": "Input is not recognizable text — appears to be random characters"}
```

**Cost:** ~200 input tokens + ~20 output tokens = $0.0003. Effectively free, but multiplied by a rogue agent sending garbage repeatedly, it adds up.

### Scenario: `valis_store({text: ""})`

**What should happen:** MCP server validates BEFORE calling Haiku. Empty string → immediate rejection, no API call.

### Required Input Validation (pre-Haiku):

```javascript
function validateInput(text) {
  if (!text || typeof text !== 'string') return { valid: false, reason: 'empty_input' };
  if (text.trim().length < 10) return { valid: false, reason: 'too_short' };
  if (text.length > 10000) return { valid: false, reason: 'too_long' };

  // Entropy check: random characters have high character diversity relative to length
  const uniqueChars = new Set(text.toLowerCase()).size;
  const ratio = uniqueChars / text.length;
  if (text.length < 50 && ratio > 0.8) return { valid: false, reason: 'likely_garbage' };

  return { valid: true };
}
```

### VERDICT: Add input validation before Haiku. Min 10 chars, max 10K chars, basic entropy check. Saves money and prevents garbage from polluting the knowledge base.

---

## Problem 6: Structured Output Reliability

### Haiku JSON Output Failure Modes

**Mode 1: Malformed JSON** (frequency: ~1-3% without mitigations)
```
{"type": "decision", "summary": "Use PostgreSQL for...
```
Truncated response due to max_tokens or model hiccup. Parser throws.

**Mode 2: Extra text around JSON** (frequency: ~5-10%)
```
Here's the classification:
{"type": "decision", ...}
```
Model wraps JSON in natural language despite instructions.

**Mode 3: Hallucinated fields** (frequency: ~2-5%)
```json
{"type": "decision", "summary": "...", "reasoning": "...", "importance": "high"}
```
Model adds fields not in the schema. Not dangerous but pollutes data.

**Mode 4: Wrong field types** (frequency: ~1-2%)
```json
{"type": "decision", "affects": "payment-service"}
```
`affects` should be array, model returns string.

**Mode 5: Hallucinated `affects` values** (frequency: ~20-30%)
```json
{"affects": ["payment-gateway-microservice", "user-management-module"]}
```
Haiku invents module names that sound reasonable but don't exist in the project. This is expected and NOT a bug — Haiku has no knowledge of the project structure. The `affects` field from extraction is a BEST GUESS that the user/agent should validate.

### Mitigations

1. **Use `response_format: { type: "json_object" }` (tool use / JSON mode):** Forces valid JSON output. Eliminates Mode 1 and Mode 2. Available in Anthropic API.

2. **Schema validation after parsing:**
```javascript
function validateExtraction(result) {
  if (result.skip === true) return result; // rejection is valid

  const required = ['type', 'summary', 'detail', 'affects', 'confidence'];
  for (const field of required) {
    if (!(field in result)) throw new Error(`Missing field: ${field}`);
  }

  if (!['decision', 'constraint', 'pattern', 'lesson'].includes(result.type)) {
    throw new Error(`Invalid type: ${result.type}`);
  }

  if (!Array.isArray(result.affects)) {
    result.affects = [result.affects].filter(Boolean); // coerce string to array
  }

  result.confidence = Math.max(1, Math.min(10, Math.round(result.confidence)));

  // Strip unknown fields
  const known = ['type', 'summary', 'detail', 'affects', 'confidence', 'search_keywords', 'skip', 'reason'];
  for (const key of Object.keys(result)) {
    if (!known.includes(key)) delete result[key];
  }

  return result;
}
```

3. **Retry once on parse failure:** If JSON is malformed, retry ONCE with the exact same input. Cost: ~$0.001 extra. Most transient failures resolve.

4. **`affects` validation is NOT possible at extraction time.** We don't know the project's module structure. This should be flagged in the UI: "affects: payment-service (unverified)" and let the user confirm/edit.

### VERDICT: JSON mode + schema validation + single retry covers 99%+ of cases. The `affects` hallucination problem is inherent and should be treated as "best guess" not "ground truth."

---

## Problem 7: One Haiku Call vs Two

### The Spec Says Two Calls:

1. **Classification:** raw text → type, summary, detail, affects, confidence
2. **Relationship detection:** search existing decisions → contradicts, depends_on, replaces

### The Question: Can We Do Both in One Call?

**One call approach — add existing decisions as context:**
```
System: [classification prompt]

User:
Classify this:
"{user_text}"

For context, here are the 5 most relevant existing decisions:
1. [id: abc] "Use PostgreSQL for payment service" (decision, affects: payment-service)
2. [id: def] "Use Redis for session caching" (decision, affects: auth-service)
...

Also determine if the new item:
- CONTRADICTS any of the above (same area, opposite choice)
- DEPENDS_ON any of the above (builds on a previous decision)
- REPLACES any of the above (supersedes an older decision)
```

**Problems with one-call approach:**
- Input balloons from ~350 tokens to ~800-1200 tokens (existing decisions add ~500-800 tokens)
- Quality degrades — Haiku is juggling classification AND comparison simultaneously
- Relationship detection accuracy drops because Haiku has to understand the semantic difference between "contradicts" and "replaces" while also classifying

**Problems with two-call approach:**
- Total latency: 2 * 3s = 6 seconds (P50). Unacceptable for inline.
- Cost doubles

**The Right Answer: One call for classification, ZERO calls for relationship detection inline.**

Relationship detection should happen ASYNC:
1. Agent stores decision → Haiku classifies inline (one call, ~3s)
2. Background worker takes the new decision → searches existing decisions by embedding similarity → Haiku compares pairs → stores relationships
3. This can take 10-30 seconds and nobody cares — it's background

### VERDICT: One Haiku call inline (classification only). Relationship detection is async background. The spec's two inline calls would create 6s+ latency per store — unacceptable.

---

## Problem 8: Token Usage and Cost Per Extraction

### Detailed Token Accounting

**Input tokens:**

| Component | Tokens | Notes |
|-----------|--------|-------|
| System prompt | ~280 | The classification prompt above |
| User text wrapper | ~20 | "Classify this engineering knowledge:" |
| Typical user text | 50-300 | Short: "We chose X because Y" (50). Long: paragraph with context (300) |
| **Total input** | **~350-600** | Median ~400 |

**Output tokens:**

| Component | Tokens | Notes |
|-----------|--------|-------|
| JSON structure | ~30 | Braces, keys, punctuation |
| type + summary | ~25 | Type: 1 token, summary: ~20-25 tokens |
| detail | ~40-80 | 1-3 sentences of context |
| affects array | ~10-15 | 2-4 module names |
| confidence | ~2 | Single number |
| search_keywords | ~50-70 | 10-12 keywords |
| **Total output** | **~160-220** | Median ~180 |

For skip/rejection output: ~15-20 tokens. Much cheaper.

### Cost Per Extraction (Haiku 4.5 pricing: $1/MTok in, $5/MTok out)

| Scenario | Input Tokens | Output Tokens | Cost |
|----------|-------------|---------------|------|
| Short text, full extraction | 350 | 160 | $0.00115 |
| Medium text, full extraction | 450 | 180 | $0.00135 |
| Long text, full extraction | 600 | 220 | $0.00170 |
| Rejection (garbage/trivial) | 320 | 20 | $0.00042 |
| **Weighted average** | **~420** | **~170** | **~$0.00127** |

### Monthly Cost Estimates

| Usage Level | Extractions/Month | Monthly Cost | Description |
|-------------|-------------------|-------------|-------------|
| Solo dev | 50-100 | $0.06-$0.13 | One dev, occasional stores |
| Small team (3-5 devs) | 300-800 | $0.38-$1.02 | Active usage |
| Medium team (10-15 devs) | 1,000-3,000 | $1.27-$3.81 | Heavy usage |
| Large team (30-50 devs) | 5,000-15,000 | $6.35-$19.05 | Enterprise |

### Cost Comparison: Haiku 4.5 vs Haiku 3.5 vs Haiku 3

| Model | Input $/MTok | Output $/MTok | Cost/Extraction | Notes |
|-------|-------------|---------------|-----------------|-------|
| Haiku 3 | $0.25 | $1.25 | $0.00032 | Cheapest, deprecated |
| Haiku 3.5 | $0.80 | $4.00 | $0.00102 | Deprecated but functional |
| **Haiku 4.5** | **$1.00** | **$5.00** | **$0.00127** | **Current, recommended** |
| Haiku 4.5 (batch) | $0.50 | $2.50 | $0.00064 | 50% off, async only |
| Haiku 4.5 (cached) | $0.10 (hit) | $5.00 | $0.00089 | System prompt cached |

### Prompt Caching Savings

The system prompt (~280 tokens) is identical for every extraction. With prompt caching:
- First call: $0.00035 (cache write at 1.25x)
- Subsequent calls: $0.000028 (cache hit at 0.1x) + output cost
- **Saves ~$0.00025 per extraction after the first call**
- Over 1000 extractions: saves $0.25 (20% reduction)

Cache has a 5-minute TTL. If extractions happen more than 5 minutes apart (likely for most teams), cache expires and no savings. The 1-hour cache costs 2x base for the write.

**Recommendation:** Enable 5-minute caching. For teams doing batch imports (seed-on-init, bulk Slack extraction), savings are meaningful. For sporadic agent stores, caching helps only if multiple extractions happen within 5 minutes.

### VERDICT: $0.001-0.002 per extraction. For a 5-dev team: ~$1/month. Cost is NOT a problem. The design spec's "$0.001 per extraction" claim is approximately correct for Haiku 4.5.

---

## Summary: All 8 Problems Ranked by Severity

| # | Problem | Severity | Impact | Fix Complexity |
|---|---------|----------|--------|----------------|
| 1 | **Latency is 3s, not 500ms** | CRITICAL | Agent blocked 3s per store, terrible UX | Async store-then-enrich |
| 7 | **Two inline Haiku calls = 6s** | CRITICAL | Would double already-bad latency | One call + async relationships |
| 2 | **No failure handling defined** | HIGH | Haiku failures break the MCP tool | Graceful degradation to raw storage |
| 6 | **JSON output reliability** | MEDIUM | ~5-10% malformed without JSON mode | JSON mode + validation + retry |
| 5 | **No input validation** | MEDIUM | Garbage pollutes KB, wastes money | Pre-Haiku validation layer |
| 4 | **Classification accuracy** | LOW | 82-88% estimated accuracy, over-extraction is main risk | Few-shot examples for rejection cases |
| 3 | **Keywords cost** | LOW | +35% per extraction ($0.33/mo extra) | Include, marginal cost near-zero |
| 8 | **Token cost** | NONE | ~$1/month for typical team | Non-issue |

---

## Recommended Architecture (Post-Analysis)

```
Agent calls valis_store({text: "We decided to use Redis..."})
  │
  ├─ 1. Input validation (sync, <1ms)
  │    Empty? Too short? Garbage? → Return error immediately
  │
  ├─ 2. SQLite INSERT (sync, <10ms)
  │    Store raw text with status='pending_extraction'
  │    Generate UUID, timestamp
  │
  ├─ 3. Return provisional result to agent (<15ms total)
  │    {id, text, status: 'pending_extraction'}
  │    Agent continues working immediately
  │
  └─ 4. Background extraction (async, 2-5s)
       ├─ Call Haiku with classification prompt
       │   ├─ Success → Parse JSON, validate schema, UPDATE SQLite
       │   ├─ 429 → Queue for retry (exponential backoff)
       │   ├─ 500/503 → Retry once, then mark 'extraction_failed'
       │   ├─ Timeout → Mark 'extraction_failed'
       │   └─ Malformed JSON → Retry once, then store raw
       │
       ├─ Generate embedding (FastEmbed local, <100ms)
       │
       └─ Relationship detection (separate Haiku call if needed)
            Search similar decisions → compare → store relationships
```

**Key change from spec:** The MCP tool returns in <15ms (always succeeds). Extraction happens async. The agent never waits for Haiku. This is the single most important architectural change.

**Trade-off:** The agent doesn't get the structured result immediately. It gets `{id, status: 'pending'}`. If it needs the classified version (e.g., to check for contradictions before proceeding), it must call `valis_search` or `valis_context` after a short delay. In practice, agents rarely need the structured version immediately — they store and move on.

---

## The Extraction Prompt — Final Version

This is the prompt to use in implementation. It includes the key improvements identified in this analysis: rejection rules with examples, explicit boundary between decision/pattern, and JSON mode enforcement.

```
You classify engineering knowledge into structured objects.

INPUT: Raw text from a developer or AI agent about a technical decision, constraint, pattern, or lesson learned.

OUTPUT: A single JSON object. No markdown, no explanation, just valid JSON.

TYPES:
- "decision": A deliberate choice between alternatives. Needs reasoning ("because", "instead of", "chosen over") or at least implicit alternatives. A point-in-time choice.
- "constraint": An external limitation imposed on the project. Not chosen — given. Requirements from clients, regulations, infrastructure limits, compatibility needs.
- "pattern": An established, ongoing convention or standard. The team follows this repeatedly. Coding standards, API conventions, naming rules, recurring architecture approaches.
- "lesson": Something learned from a mistake, incident, or unexpected outcome. Contains: what went wrong + what was the fix/learning.

CONFIDENCE:
- 9-10: Explicit statement with clear reasoning
- 7-8: Clear statement, reasoning partially implied
- 5-6: Inferred from context, some ambiguity
- 3-4: Weak signal, might be discussion not decision
- 1-2: Very uncertain, likely noise

REJECT with {"skip": true, "reason": "..."} when:
- Trivial: typo fixes, formatting, import changes
- Unresolved: "maybe we should...", "what about...", "should we use X?"
- Status: "deployed to staging", "merged PR #42", "tests pass"
- Empty or unintelligible input

Examples of rejection:
- "Maybe we should consider using GraphQL" → {"skip": true, "reason": "Unresolved discussion, no decision made"}
- "Fixed typo in README" → {"skip": true, "reason": "Trivial change"}
- "Deployed v2.3 to production" → {"skip": true, "reason": "Status update, not a decision"}

OUTPUT:
{
  "type": "decision|constraint|pattern|lesson",
  "summary": "max 100 chars, verb or noun phrase",
  "detail": "What, why, alternatives if any. 1-3 sentences.",
  "affects": ["module-or-area-names"],
  "confidence": 1-10,
  "search_keywords": ["up to 12 keywords including synonyms and abbreviations"]
}
```

### Token count of final prompt: ~340 tokens (system) + ~20 (user wrapper) = ~360 input tokens baseline.
