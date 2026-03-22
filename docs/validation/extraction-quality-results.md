# Extraction Quality Test — Results

**Date:** 2026-03-17
**Project tested:** /Users/todmy/PBaaS

## Source 1: CLAUDE.md Parsing

**File:** /Users/todmy/.claude/CLAUDE.md
**Items extracted:** 16
**Precision:** 75% (12 clearly useful, 4 stylistic)

Useful items include: Qdrant knowledge retention pattern, git commit conventions, game project technical decisions (tile sizes, z-layers, asset pipeline), language constraints, API key management rules.

Stylistic items (lower value): communication style preferences, emoji/jargon avoidance. These are valid for AI agent behavior but less useful for engineering decision tracking.

**Verdict:** CLAUDE.md seeding is viable. Most projects have 10-20 extractable rules/decisions.

## Source 2: Git Log (50 commits)

**Decision-like commits:** 6/50 (12%)
**Noise:** 44/50 (content creation "feat: add post on X", maintenance "chore: update metrics")

**Important caveat:** This is a CONTENT project (LinkedIn posts, research), not a CODE project. Code projects typically have higher decision density in commits (architecture changes, dependency choices, migration decisions).

**Filtering strategy:** Skip commits matching patterns: `chore:`, `feat: add.*post`, `fix typo`, `update metrics`. This would raise precision to ~40-50% on remaining commits.

## Source 3: Transcript Files

**Finding:** 90+ .jsonl files found, ALL in `subagents/` directories. These are subagent transcripts (research agents, content agents), not main user session transcripts.

**Main session transcripts** are stored separately (not in subagents/). The Stop hook's `transcript_path` would point to the main session file.

**Could not test transcript extraction** — need to locate main session format. This is a gap that must be resolved before implementation.

## Overall Assessment

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| CLAUDE.md precision | >60% | 75% | ✅ PASS |
| Git log precision (raw) | >60% | 12% | ❌ FAIL (needs filtering) |
| Git log precision (filtered) | >60% | ~40-50% est | 🟡 BORDERLINE |
| Transcript precision | >60% | NOT TESTED | ⚠️ GAP |
| Day 1 seed count | 15-30 | 16 (CLAUDE.md only) | ✅ PASS (with CLAUDE.md alone) |

## Key Findings

1. **CLAUDE.md seeding alone gives 15-30 items on Day 1** — cold start partially solved
2. **Git log needs heavy filtering** — raw precision too low, but filtered can work
3. **Transcript extraction is the critical unknown** — main session format needs investigation
4. **Content projects ≠ code projects** — extraction quality will be higher for code repos
5. **75% precision from structured files (CLAUDE.md) is achievable without LLM** — just regex/pattern matching

## Recommendations

1. MVP: Seed from CLAUDE.md + AGENTS.md + .cursorrules + ADR files (structured, high precision)
2. MVP: Git log seeding with filtering (skip noise patterns)
3. Phase 2: Transcript extraction (needs format investigation first)
4. Phase 2: LLM-enhanced extraction for git log (Haiku classifies commit relevance)
