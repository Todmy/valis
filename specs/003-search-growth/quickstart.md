# Validation Checklist: Search Intelligence, Data Quality & Growth

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-24
**Spec**: [spec.md](./spec.md)

## Instructions

For each user story, verify every acceptance scenario independently.
Mark each scenario as PASS, FAIL, or SKIP (with reason). A story
passes only when all scenarios pass.

---

## US1 — Proposed Status Workflow (P1)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 1.1 | Store decision with `status: 'proposed'` | Stored as proposed, visible in search with "proposed" label | [ ] |
| 1.2 | Run `teamind dashboard` with proposed decisions | "Proposed (N)" section listing decisions awaiting review | [ ] |
| 1.3 | Call `teamind_lifecycle({ action: 'promote', decision_id })` on proposed decision | Transitions to `active` with audit entry | [ ] |
| 1.4 | Call `teamind_lifecycle({ action: 'deprecate', decision_id })` on proposed decision | Proposal rejected (deprecated) with audit entry | [ ] |
| 1.5 | Store proposed decision with cross-session push active | All team members receive notification about new proposal | [ ] |

**Validation commands**:
```bash
# 1.1: Store a proposed decision
teamind store --status proposed "Use Redis for session caching"

# 1.2: Check dashboard
teamind dashboard

# 1.3: Promote (get decision_id from store output)
teamind lifecycle --action promote --decision-id <id>

# 1.4: Reject (store another proposed, then deprecate)
teamind lifecycle --action deprecate --decision-id <id> --reason "Team chose alternative"
```

---

## US2 — Cursor IDE Integration (P2)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 2.1 | Run `teamind init` with Cursor installed (`~/.cursor/` exists) | Cursor detected and listed in IDE list | [ ] |
| 2.2 | After init, check Cursor MCP config and `.cursorrules` | MCP server config in `~/.cursor/mcp.json`, instruction markers in `.cursorrules` | [ ] |
| 2.3 | Start Cursor with Teamind MCP server | All 4 tools available: `teamind_store`, `teamind_search`, `teamind_context`, `teamind_lifecycle` | [ ] |
| 2.4 | Run `teamind init` again (idempotency) | No duplicate entries in MCP config or `.cursorrules` | [ ] |
| 2.5 | Run `teamind uninstall` | Cursor MCP config and `.cursorrules` markers cleanly removed | [ ] |

**Validation commands**:
```bash
# 2.1: Init with Cursor present
mkdir -p ~/.cursor  # Simulate Cursor installation
teamind init

# 2.2: Verify config files
cat ~/.cursor/mcp.json
cat .cursorrules

# 2.4: Idempotency check
teamind init
diff <(cat ~/.cursor/mcp.json) <(cat ~/.cursor/mcp.json)  # Should be identical

# 2.5: Uninstall
teamind uninstall
cat ~/.cursor/mcp.json  # teamind entry should be gone
cat .cursorrules         # teamind markers should be gone
```

---

## US3 — Smart Dedup & Data Cleanup (P3)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 3.1 | Store 5 decisions with identical content, run cleanup | Duplicates identified, newest kept, others deprecated with "auto-dedup" reason | [ ] |
| 3.2 | Store 5 decisions with cosine similarity >0.9, run cleanup | Near-duplicates flagged for review (not auto-deprecated) | [ ] |
| 3.3 | Have `pending` decisions older than 30 days, run cleanup | Flagged as stale orphans in report | [ ] |
| 3.4 | Run `teamind admin cleanup --dry-run` | Shows what would be cleaned without making changes | [ ] |
| 3.5 | Run `teamind admin cleanup --apply` | Changes applied, audit entries created for each action | [ ] |
| 3.6 | Verify scheduled cleanup executes same logic as `--apply` | Runs periodically, logs results | [ ] |

**Validation commands**:
```bash
# 3.1: Create exact duplicates
for i in 1 2 3 4 5; do
  teamind store "Use PostgreSQL for user data"
done

# 3.4: Dry run
teamind admin cleanup --dry-run

# 3.5: Apply
teamind admin cleanup --apply

# Verify audit trail
teamind admin audit --action decision_auto_deduped
```

---

## US4 — Web Dashboard (P4)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 4.1 | Open dashboard, enter API key | Dashboard exchanges for JWT, shows org decisions, stats, activity | [ ] |
| 4.2 | Search from dashboard | Results match CLI search quality (same ranking, same labels) | [ ] |
| 4.3 | View proposed decisions section | "Proposed" section shows decisions awaiting review | [ ] |
| 4.4 | View contradictions section | Contradictions displayed with decision pairs and overlap areas | [ ] |
| 4.5 | Attempt to modify data | No write operations available (read-only) | [ ] |
| 4.6 | Store decision via CLI, refresh dashboard | New decision appears within 10 seconds | [ ] |
| 4.7 | Authenticate as member of org A, check tenant isolation | Only org A data visible | [ ] |

**Validation steps**:
```
1. Open https://dashboard.teamind.dev
2. Enter member API key (tmm_...)
3. Verify decisions list loads with status badges
4. Use search bar — compare results with CLI search
5. Navigate to /proposed, /contradictions, /dashboard
6. Inspect browser DevTools Network tab — verify no POST/PUT/DELETE requests
7. Store a decision via CLI and refresh dashboard
```

---

## US5 — Confidence Decay & Pinned Decisions (P5)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 5.1 | Two equal-relevance decisions, 90 days apart | Newer decision ranks higher in search | [ ] |
| 5.2 | Verify 180-day-old decision has ~25% effective relevance | `effective_score ~= 0.25 * base_score` | [ ] |
| 5.3 | Pin a 180-day-old decision | Effective relevance does not decay, ranks as if fresh | [ ] |
| 5.4 | Admin pins a decision | `pinned = true` with audit entry. Non-admin cannot pin | [ ] |
| 5.5 | Admin unpins a decision | Normal decay resumes from current age | [ ] |
| 5.6 | View pinned decisions in dashboard | Pinned decisions visually marked | [ ] |

**Validation commands**:
```bash
# 5.1: Store two decisions (one backdated in test fixture)
# Search and compare scores

# 5.4: Pin as admin
teamind lifecycle --action pin --decision-id <old-decision-id>

# 5.5: Unpin
teamind lifecycle --action unpin --decision-id <old-decision-id>

# Verify audit
teamind admin audit --target <decision-id>
```

---

## US6 — Multi-Signal Reranking (P6)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 6.1 | Search returns results with composite score | Each result includes composite score and individual signal values | [ ] |
| 6.2 | Two equally relevant decisions, one with 3 dependents | Well-connected one ranks higher | [ ] |
| 6.3 | Highly relevant old vs moderately relevant new | Fresh one ranks higher (recency wins at equal relevance) | [ ] |
| 6.4 | Pinned decision with low semantic relevance | Pin boost keeps it in top results when query matches affects area | [ ] |
| 6.5 | Rerank 50 results in <10ms | Performance benchmark passes | [ ] |

**Validation commands**:
```bash
# 6.1: Search with verbose output
teamind search "database choice" --verbose
# Output should show: composite_score, semantic, bm25, recency, importance, graph

# 6.5: Performance test (via test suite)
npm test -- --grep "reranking.*performance"
```

---

## US7 — Retrieval-Induced Suppression (P7)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 7.1 | 5 decisions in same affects area, one dominant (>1.5x) | Lower-ranked ones suppressed from default results | [ ] |
| 7.2 | Search with `--all` flag | All results including suppressed ones returned with `suppressed: true` label | [ ] |
| 7.3 | MCP `teamind_search` response | Includes `suppressed_count` field | [ ] |
| 7.4 | Decisions in different affects areas both match query | Cross-area results not suppressed | [ ] |

**Validation commands**:
```bash
# 7.1: Default search
teamind search "database"
# Should show top 1-2 results from same area

# 7.2: Full search
teamind search "database" --all
# Should show all results with suppression labels

# 7.4: Cross-area query
teamind search "architecture"
# Results from different areas should all appear
```

---

## US8 — LLM Enrichment Pipeline (P8)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 8.1 | Run `teamind enrich` with LLM key and pending decisions | Pending decisions classified with type, summary, affects | [ ] |
| 8.2 | Run `teamind enrich` without LLM key | Exits with "No LLM provider configured. Pending decisions unchanged." | [ ] |
| 8.3 | Run `teamind serve` without LLM key | All core operations work normally | [ ] |
| 8.4 | Verify enriched decision metadata | Marked with `enriched_by: 'llm'` and audit entry created | [ ] |
| 8.5 | Hit daily cost ceiling ($1 default) | Enrichment stops, resumes tomorrow | [ ] |
| 8.6 | Run `teamind enrich --dry-run` | Shows what would be classified without making changes | [ ] |

**Validation commands**:
```bash
# 8.1: With LLM key configured
export ENRICHMENT_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-...
teamind enrich

# 8.2: Without key
unset ANTHROPIC_API_KEY
unset ENRICHMENT_PROVIDER
teamind enrich

# 8.3: Core operations without enrichment
teamind serve  # Should start normally
# Store, search, context, lifecycle should all work

# 8.6: Dry run
teamind enrich --dry-run
```

---

## US9 — Pattern Synthesis (P9)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 9.1 | 3+ decisions with overlapping affects in time window | Pattern detected and stored as `type: 'pattern'`, `source: 'synthesis'` | [ ] |
| 9.2 | Pattern stored | Active sessions receive push notification | [ ] |
| 9.3 | View dashboard patterns section | "Patterns" section shows trends with decision counts | [ ] |
| 9.4 | Run synthesis twice on same cluster | No duplicate pattern created (idempotent) | [ ] |
| 9.5 | Deprecate all source decisions, re-run synthesis | Pattern auto-deprecated | [ ] |
| 9.6 | Run `teamind admin patterns` manually | Synthesis executes immediately and reports results | [ ] |

**Validation commands**:
```bash
# 9.1: Create a cluster
teamind store --affects auth "Use JWT for API authentication"
teamind store --affects auth "Use JWT for session management"
teamind store --affects auth "Use JWT for service-to-service auth"
teamind store --affects auth "Use JWT for webhook verification"

# 9.6: Run synthesis
teamind admin patterns

# 9.4: Run again (idempotent)
teamind admin patterns
# Should report "0 new patterns (1 existing)"

# Verify pattern
teamind search "auth pattern" --type pattern
```

---

## US10 — Usage-Based Pricing (P10)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 10.1 | Free org at 500/500 decisions, attempt store | Blocked with upgrade message (not silent failure) | [ ] |
| 10.2 | Paid org exceeds limit with overage enabled | Extra decisions stored, counted as overage | [ ] |
| 10.3 | Admin accesses billing portal | Can upgrade plan, view usage, see invoices | [ ] |
| 10.4 | Billing cycle ends with overage | Overage charges calculated and billed automatically | [ ] |
| 10.5 | Failed payment, grace period (7 days) expires | Org downgraded to free tier limits | [ ] |
| 10.6 | Dashboard usage view | Current decision count, search count, remaining quota displayed | [ ] |

**Validation commands**:
```bash
# 10.1: (requires test org at limit)
teamind store "One more decision"
# Should show: "Free tier limit reached (500/500). Upgrade to Team ($25/mo)..."

# 10.3: Upgrade
teamind upgrade --plan team

# 10.6: Check usage
teamind dashboard
# Should show usage metrics section
```

---

## Cross-Cutting Validation

| # | Check | Expected | Status |
|---|-------|----------|--------|
| C.1 | Backward compatibility | MVP and Phase 2 installations function without changes after Phase 3 deployment | [ ] |
| C.2 | Audit trail completeness | Every automated action (cleanup, enrichment, synthesis) has an audit entry | [ ] |
| C.3 | Tenant isolation | Dashboard, search, and all operations enforce org_id scoping | [ ] |
| C.4 | Non-blocking billing | Store and search succeed even when billing infrastructure is down | [ ] |
| C.5 | Enrichment independence | All core operations work with no LLM key configured | [ ] |
