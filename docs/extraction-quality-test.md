# Extraction Quality Test Plan

## Goal

Validate that LLM can extract **decisions, constraints, patterns, and lessons** from real developer activity with acceptable quality (>60% precision) across 3 input types.

## Context

Based on Grov's approach (analyzed from source code):
- Grov uses Claude Haiku for extraction AFTER session ends
- Extracts: `decisions` (aspect/choice/reason), `reasoning_trace` (aspect/conclusion/insight)
- Stores in SQLite locally + Supabase cloud with OpenAI embeddings (1536 dims)
- Weakness: only captures from AI coding sessions, not Slack/PRs/meetings

Our product captures from ALL sources. This test validates extraction quality across each.

---

## Test 1: AI Coding Session Transcripts (Grov's territory)

### Setup
Take 5 real Claude Code / Cursor session transcripts from your own work. Each should contain at least 1 architectural decision.

### Extraction Prompt (improved from Grov's `llm-extractor.ts`)

```
You are analyzing an AI coding session transcript between a developer and an AI assistant.

Extract ONLY items that would be valuable for OTHER developers on the team to know in future sessions.

For each extracted item, classify as:
- DECISION: A choice between alternatives (e.g., "chose PostgreSQL over MongoDB because...")
- CONSTRAINT: A limitation or requirement (e.g., "must support Safari 15+")
- PATTERN: A recurring approach or convention (e.g., "all API endpoints follow /api/v1/{resource}")
- LESSON: Something learned from experience (e.g., "N+1 query caused timeout in OrderService")

Output JSON array:
[
  {
    "type": "decision|constraint|pattern|lesson",
    "summary": "One-line description (max 100 chars)",
    "detail": "Full context: what, why, alternatives considered, who decided",
    "affects": ["list of files, modules, or areas affected"],
    "confidence": 1-10,
    "source_quote": "Exact quote from transcript that contains this information"
  }
]

Rules:
- SKIP trivial items (typo fixes, formatting, import reordering)
- SKIP implementation details that are obvious from code (variable names, syntax)
- INCLUDE items where the WHY matters, not just the WHAT
- If no items found, return empty array []
- confidence < 5 = uncertain, might be wrong interpretation

<transcript>
{PASTE SESSION TRANSCRIPT HERE}
</transcript>
```

### Evaluation Criteria
For each extracted item, score:
- **Relevant**: Would another dev benefit from knowing this? (yes/no)
- **Accurate**: Is the extraction faithful to the original? (yes/no)
- **Complete**: Is the context sufficient to understand without original? (yes/no)
- **Actionable**: Can someone act on this information? (yes/no)

**Precision** = relevant items / total extracted items
**Target**: >60% precision, ideally >75%

---

## Test 2: GitHub PR Reviews (NEW — Grov doesn't do this)

### Setup
Take 10 PR reviews from a real repo. Mix of:
- 3 PRs with architectural discussions in comments
- 3 PRs with simple approvals ("LGTM")
- 2 PRs with requested changes and reasoning
- 2 PRs with constraint discussions ("we can't do X because Y")

Use GitHub API or manually copy PR description + all review comments.

### Extraction Prompt

```
You are analyzing a GitHub Pull Request and its review comments.

Extract decisions, constraints, patterns, and lessons that were DISCUSSED or ESTABLISHED in this PR review. Focus on items that affect the team's future work, not this specific PR.

For each extracted item, classify as:
- DECISION: A choice made during review (e.g., "reviewer asked to use Strategy pattern instead of if/else chain")
- CONSTRAINT: A limitation discovered or enforced (e.g., "must maintain backward compatibility with v2 API")
- PATTERN: A convention established or enforced (e.g., "all error responses should include error_code field")
- LESSON: A problem found that others should avoid (e.g., "N+1 query in this pattern — avoid eager loading")

Output JSON array:
[
  {
    "type": "decision|constraint|pattern|lesson",
    "summary": "One-line description (max 100 chars)",
    "detail": "Full context including why and alternatives",
    "affects": ["files, modules, or areas"],
    "decided_by": "reviewer/author name if identifiable",
    "confidence": 1-10,
    "source_quote": "Exact quote from PR that contains this"
  }
]

Rules:
- SKIP "LGTM", "looks good", formatting-only comments
- SKIP items that are specific to this PR and have no future relevance
- INCLUDE review comments that establish or enforce a pattern for the team
- If this PR has no extractable team knowledge, return empty array []

<pr_title>{TITLE}</pr_title>
<pr_description>{DESCRIPTION}</pr_description>
<review_comments>
{ALL REVIEW COMMENTS WITH AUTHOR AND TIMESTAMP}
</review_comments>
```

### Evaluation
Same 4 criteria (Relevant, Accurate, Complete, Actionable).

**Additional check for PRs**: How many "LGTM-only" PRs correctly return empty array? (should be 100%)

---

## Test 3: Slack Conversations (NEW — nobody does this well yet)

### Setup
Take 5 Slack thread excerpts:
- 2 threads with clear technical decisions ("let's use X because Y")
- 1 thread with constraints discussed ("client requires Z")
- 1 thread with no decisions (casual chat, questions without resolution)
- 1 thread with implied/ambiguous decisions

### Extraction Prompt

```
You are analyzing a Slack conversation thread from an engineering team.

Extract decisions, constraints, patterns, and lessons that were RESOLVED in this thread. A decision requires at least implicit agreement (not just one person's opinion).

For each extracted item, classify as:
- DECISION: A choice the team agreed on (explicit "let's do X" or implicit consensus)
- CONSTRAINT: A limitation mentioned that affects future work
- PATTERN: A convention or approach agreed upon
- LESSON: An insight shared from experience

Output JSON array:
[
  {
    "type": "decision|constraint|pattern|lesson",
    "summary": "One-line description",
    "detail": "Full context including reasoning",
    "affects": ["areas affected"],
    "participants": ["who was involved in this discussion"],
    "resolution_status": "resolved|open|implied",
    "confidence": 1-10,
    "source_quote": "Key quote"
  }
]

Rules:
- ONLY extract items with at least implied resolution (not open questions)
- "resolution_status: implied" = no explicit agreement but the approach was used after discussion
- "resolution_status: open" = discussed but not resolved — extract with confidence < 4
- If thread is casual/off-topic with no technical content, return empty array []
- SKIP pleasantries, emoji reactions, off-topic tangents

<slack_thread>
{PASTE SLACK THREAD HERE}
</slack_thread>
```

### Evaluation
Same 4 criteria + special checks:
- **False positive rate on casual threads**: Should return empty array for non-decision threads
- **Implied decisions**: Are they correctly identified? These are the hardest and most valuable.

---

## Scoring Sheet

| Test | Input | # Items Extracted | Relevant | Accurate | Complete | Actionable | Precision |
|------|-------|-------------------|----------|----------|----------|------------|-----------|
| 1.1 | Session transcript 1 | | | | | | |
| 1.2 | Session transcript 2 | | | | | | |
| 1.3 | Session transcript 3 | | | | | | |
| 1.4 | Session transcript 4 | | | | | | |
| 1.5 | Session transcript 5 | | | | | | |
| 2.1 | PR with arch discussion | | | | | | |
| 2.2 | PR with arch discussion | | | | | | |
| 2.3 | PR with arch discussion | | | | | | |
| 2.4 | PR "LGTM" only | | | | | | |
| 2.5 | PR "LGTM" only | | | | | | |
| 2.6 | PR "LGTM" only | | | | | | |
| 2.7 | PR with changes requested | | | | | | |
| 2.8 | PR with changes requested | | | | | | |
| 2.9 | PR with constraints | | | | | | |
| 2.10 | PR with constraints | | | | | | |
| 3.1 | Slack: clear decision | | | | | | |
| 3.2 | Slack: clear decision | | | | | | |
| 3.3 | Slack: constraint | | | | | | |
| 3.4 | Slack: no decision (casual) | | | | | | |
| 3.5 | Slack: implied decision | | | | | | |

## Go / No-Go Criteria

| Metric | Go | Caution | Kill |
|--------|-----|---------|------|
| Overall precision | >70% | 50-70% | <50% |
| Session precision | >75% | 60-75% | <60% |
| PR precision | >65% | 50-65% | <50% |
| Slack precision | >55% | 40-55% | <40% |
| False positive on empty inputs | <10% | 10-25% | >25% |

## Improvement Signals

If precision is in "Caution" zone, try:
1. Two-pass extraction: first extract, then filter with second LLM call (confidence threshold)
2. Human-in-the-loop: extract → show in dashboard → human approves/rejects → model learns
3. Structured schema: force output into decision schema with required fields → reduces noise
4. Source-specific prompts: different prompt per input type (as above) vs one generic prompt

## What Grov Does vs What We Should Improve

| Aspect | Grov | Our Improvement |
|--------|------|-----------------|
| Extraction model | Claude Haiku | Claude Haiku (same — fast, cheap) |
| When | After session ends | Real-time (after each significant exchange) |
| Storage | SQLite + Supabase (Postgres) | Qdrant (vector) + Postgres (structured) |
| Embeddings | OpenAI text-embedding-3-small (1536) | Same or Cohere embed-v4 (better multilingual) |
| Search | Hybrid semantic + lexical (Postgres RPC) | Same approach but Qdrant native |
| Sources | AI sessions only | AI sessions + Slack + PRs + meetings |
| Drift detection | Every 5 mod tool calls, Haiku scoring | Same + cross-session organizational drift |
| Injection | Preview → expand (max 3) | Same pattern, increase to 5-7 with relevance ranking |
| Streaming | Disabled (buffers full response) | Must preserve streaming (critical UX) |
| MCP | grov_preview + grov_expand | Same + grov_store (agents write back) + grov_search |
