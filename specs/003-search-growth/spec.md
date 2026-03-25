# Feature Specification: Search Intelligence, Data Quality & Growth

**Feature Branch**: `003-search-growth`
**Created**: 2026-03-24
**Status**: Draft
**Input**: Team lead analysis of 11 features across Phase 3A, 3B, 4A

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Proposed Status Workflow (Priority: P1)

A Tech Lead wants to propose a decision for team discussion before
making it official. They store a decision with `status: proposed` via
the MCP tool. The decision appears in the team brain as "proposed" —
visible to everyone but clearly labeled as not yet approved. Any team
member can review proposed decisions and promote them to `active` or
reject them. The web dashboard and CLI both show a "Proposed" queue
for easy review.

**Why this priority**: The `proposed` status already exists in the
schema but has no dedicated workflow. This is a 1-2 day effort that
immediately enables a team decision-making process — the most
requested workflow gap from beta testers.

**Independent Test**: Store a decision with `status: proposed`. Verify
it appears in search results labeled as "proposed." Promote it via
`valis_lifecycle`. Verify it transitions to `active` with audit trail.

**Acceptance Scenarios**:

1. **Given** a developer, **When** they call `valis_store` with
   `status: 'proposed'`, **Then** the decision is stored as proposed
   and visible in search with a "proposed" label.
2. **Given** proposed decisions exist, **When** a member runs
   `valis dashboard`, **Then** they see a "Proposed (N)" section
   listing decisions awaiting review.
3. **Given** a proposed decision, **When** any member calls
   `valis_lifecycle({ action: 'promote', decision_id })`, **Then**
   the decision transitions to `active` with an audit entry.
4. **Given** a proposed decision, **When** any member calls
   `valis_lifecycle({ action: 'deprecate', decision_id })`, **Then**
   the proposal is rejected (deprecated) with an audit entry.
5. **Given** a new proposed decision, **When** cross-session push is
   active, **Then** all team members receive a notification about the
   new proposal.

---

### User Story 2 - Cursor IDE Integration (Priority: P2)

A developer using Cursor as their AI coding IDE runs `valis init`
and Cursor is auto-detected alongside Claude Code and Codex. Valis
configures Cursor's MCP settings, injects decision-awareness
instructions into `.cursorrules`, and seeds the brain. From that point,
Cursor's AI agent can store, search, and receive decisions just like
Claude Code and Codex users.

**Why this priority**: Cursor has the largest market share among AI
IDEs. Not supporting Cursor cuts off the biggest addressable audience.
The integration pattern already exists for Claude Code and Codex — this
is a copy-adapt exercise.

**Independent Test**: Install Valis on a machine with Cursor. Run
`valis init`. Verify Cursor MCP config is created, `.cursorrules`
has Valis instructions, and the MCP server works with Cursor.

**Acceptance Scenarios**:

1. **Given** Cursor is installed (`~/.cursor/` exists), **When** the
   user runs `valis init`, **Then** Cursor is detected and listed.
2. **Given** Cursor detected, **When** init configures IDEs, **Then**
   MCP server config is added to Cursor's settings and `.cursorrules`
   receives Valis instruction markers between delimiters.
3. **Given** Cursor configured, **When** the user starts Cursor with
   Valis MCP server, **Then** `valis_store`, `valis_search`,
   `valis_context`, and `valis_lifecycle` tools are available.
4. **Given** Valis already configured for Cursor, **When** init
   runs again, **Then** no duplicate entries are created (idempotent).
5. **Given** `valis uninstall`, **When** it runs, **Then** Cursor
   MCP config and `.cursorrules` markers are cleanly removed.

---

### User Story 3 - Smart Dedup & Data Cleanup (Priority: P3)

As the team brain grows to hundreds of decisions, duplicates
accumulate (same decision captured by multiple layers) and orphaned
`pending` decisions pile up (raw captures that were never classified).
A scheduled cleanup process identifies near-duplicates (same content
hash or cosine similarity > 0.9), flags stale orphans (pending for
30+ days), and suggests merge/cleanup actions. An admin can run
cleanup manually or let it run on a schedule.

**Why this priority**: Data quality degrades trust. Before adding
advanced search intelligence (decay, reranking), the data must be
clean. This also establishes the scheduled-job pattern reused by
pattern synthesis and LLM enrichment later.

**Independent Test**: Store 5 near-duplicate decisions. Run
`valis admin cleanup --dry-run`. Verify it identifies the duplicates
and suggests which to keep.

**Acceptance Scenarios**:

1. **Given** decisions with identical content hashes in the same org,
   **When** cleanup runs, **Then** duplicates are identified and the
   newest is kept, others deprecated with reason "auto-dedup."
2. **Given** decisions with cosine similarity > 0.9 in the same org,
   **When** cleanup runs, **Then** near-duplicates are flagged for
   review (not auto-deprecated — only exact dupes are auto-handled).
3. **Given** `pending` decisions older than 30 days, **When** cleanup
   runs, **Then** they are flagged as stale orphans in the report.
4. **Given** `valis admin cleanup --dry-run`, **When** it runs,
   **Then** it shows what would be cleaned without making changes.
5. **Given** `valis admin cleanup --apply`, **When** it runs,
   **Then** changes are applied and audit entries created for each
   action.
6. **Given** a scheduled cleanup, **When** it runs periodically,
   **Then** it executes the same logic as `--apply` and logs results.

---

### User Story 4 - Web Dashboard (Priority: P4)

An Engineering Manager opens the Valis web dashboard in their
browser to see the team's decision brain without using the CLI. They
see a searchable list of all decisions with status labels, a
contradiction view, lifecycle statistics, team activity timeline, and
proposed decisions awaiting review. The dashboard is read-only — all
mutations happen through the CLI or MCP tools.

**Why this priority**: The buyer persona (Eng Manager / Tech Lead)
does not live in the CLI. The web dashboard is the conversion trigger
for Team/Business plan upgrades. Building it early de-risks the
largest new technology surface (frontend, auth, deployment).

**Independent Test**: Open the web dashboard, enter a member API key,
see all org decisions, search them, view contradictions and lifecycle
stats. Verify no write operations are possible.

**Acceptance Scenarios**:

1. **Given** a team member, **When** they open the dashboard URL and
   enter their member API key, **Then** the dashboard exchanges it for
   a JWT and shows their org's decisions, stats, and activity.
2. **Given** the dashboard, **When** a user searches, **Then** results
   match CLI search quality (same ranking, same status labels).
3. **Given** proposed decisions, **When** viewing the dashboard,
   **Then** a "Proposed" section shows decisions awaiting review.
4. **Given** open contradictions, **When** viewing the dashboard,
   **Then** contradictions are displayed with decision pairs and
   overlap areas.
5. **Given** the dashboard, **When** a user tries to modify data,
   **Then** no write operations are available (read-only).
6. **Given** a decision stored via CLI, **When** the dashboard is
   refreshed, **Then** the new decision appears within 10 seconds.
7. **Given** multiple orgs, **When** a member authenticates, **Then**
   they only see their own org's data (tenant isolation).

---

### User Story 5 - Confidence Decay & Pinned Decisions (Priority: P5)

Decisions made 6 months ago without updates naturally lose relevance
in search results. A decision about "use Express.js for the API"
from January gradually ranks lower than a recent decision about
"migrate to Fastify for the API" from this week — even if both match
the query equally. Critical decisions (architecture principles,
security constraints) can be "pinned" by an admin so they never
decay, always appearing at the top of relevant searches.

**Why this priority**: Without decay, the brain accumulates noise as
it grows. Old, outdated decisions compete equally with fresh ones.
Decay + pinning is the foundation signal for the multi-signal
reranking pipeline that follows.

**Independent Test**: Store two decisions about the same topic, 90
days apart. Search — verify the newer one ranks higher. Pin the older
one. Search again — verify the pinned one is now at the top.

**Acceptance Scenarios**:

1. **Given** two decisions with equal relevance scores, **When** one
   is 90 days old and the other is 1 day old, **Then** the newer
   decision ranks higher in search results.
2. **Given** a decay half-life of 90 days, **When** a decision is
   180 days old, **Then** its effective relevance is ~25% of original.
3. **Given** a pinned decision, **When** it is 180 days old, **Then**
   its effective relevance does not decay — it ranks as if fresh.
4. **Given** an admin, **When** they call `valis_lifecycle` with
   `action: 'pin'`, **Then** the decision is pinned with an audit
   entry. Only admins can pin.
5. **Given** a pinned decision, **When** an admin unpins it, **Then**
   normal decay resumes from the current age.
6. **Given** the dashboard, **When** viewing decisions, **Then**
   pinned decisions are visually marked.

---

### User Story 6 - Multi-Signal Reranking (Priority: P6)

Search results are ranked by a composite score combining 5 signals:
semantic relevance, keyword match (BM25), recency (decay), decision
importance (confidence + pin status), and graph connectivity (how many
other decisions depend on or replace this one). A decision that is
semantically relevant, recent, pinned, and heavily connected ranks
dramatically higher than one that merely matches keywords.

**Why this priority**: This is the core search quality improvement.
The current search uses a single Qdrant score + status tiebreaker.
Multi-signal reranking is what makes the team brain *intelligent*.

**Independent Test**: Store 10 decisions with varying ages,
confidence levels, and dependency relationships. Search with a query
that matches multiple. Verify that the result order reflects the
composite scoring, not just semantic similarity.

**Acceptance Scenarios**:

1. **Given** a search query, **When** results are returned, **Then**
   each result includes a composite score and the individual signal
   values (for debugging/transparency).
2. **Given** two equally relevant decisions, **When** one has 3
   dependents and the other has 0, **Then** the well-connected one
   ranks higher.
3. **Given** a highly relevant but old decision, **When** a moderately
   relevant but fresh decision exists, **Then** the fresh one ranks
   higher (recency wins at equal relevance).
4. **Given** a pinned decision with low semantic relevance, **When**
   searched, **Then** the pin boost is strong enough to keep it in top
   results when the query matches its `affects` area.
5. **Given** the current search latency target (<200ms), **When**
   reranking runs on 50 results, **Then** the additional scoring
   adds less than 10ms overhead.

---

### User Story 7 - Retrieval-Induced Suppression (Priority: P7)

When searching for "database choice," the team brain has 8 decisions
mentioning databases. After reranking, the top result is "Use
PostgreSQL for user data" (active, pinned, 5 dependents). The
remaining 7 results include 4 superseded decisions and 3 tangentially
related ones. Suppression reduces noise: similar decisions that rank
significantly below the top result in the same `affects` area are
suppressed from default results (still accessible with a `--all`
flag or by the agent explicitly requesting full results).

**Why this priority**: As teams accumulate 1000+ decisions, search
results become noisy. Suppression is the post-reranking filter that
ensures the agent sees the most relevant decisions without wading
through redundant ones.

**Independent Test**: Store 5 similar decisions in the same area.
Search — verify that only the top 2 appear in default results. Use
`--all` to verify all 5 are still accessible.

**Acceptance Scenarios**:

1. **Given** 5 decisions in the same `affects` area, **When** one
   ranks >1.5x above the second, **Then** the lower-ranked ones are
   suppressed from default results.
2. **Given** suppressed results, **When** the user searches with
   `--all` flag, **Then** all results including suppressed ones are
   returned with a `suppressed: true` label.
3. **Given** suppressed results, **When** the MCP `valis_search`
   tool is called, **Then** the response includes a
   `suppressed_count` field indicating how many were hidden.
4. **Given** decisions in different `affects` areas, **When** both
   match a query, **Then** suppression only applies within the same
   area — cross-area results are not suppressed.

---

### User Story 8 - LLM Enrichment Pipeline (Priority: P8)

Auto-captured decisions from the file watcher and startup sweep are
stored as `type: 'pending'` with raw, unclassified text. The LLM
enrichment pipeline processes these pending decisions in the
background: classifying their type (decision/constraint/pattern/
lesson), generating a summary, and extracting `affects` areas. The
pipeline is strictly optional — it requires an LLM API key and can
be disabled entirely. Core operations never depend on it.

**Why this priority**: ~30% of stored decisions are unclassified
pending blobs. Enrichment turns them into properly typed, summarized,
searchable decisions. This dramatically improves search quality for
auto-captured content.

**Independent Test**: Store 5 `type: 'pending'` decisions via file
watcher. Run `valis enrich`. Verify each gets a type, summary, and
affects assigned. Verify the system works without any LLM key
configured.

**Acceptance Scenarios**:

1. **Given** pending decisions and an LLM API key configured, **When**
   `valis enrich` runs, **Then** pending decisions are classified
   with type, summary, and affects.
2. **Given** no LLM API key, **When** `valis enrich` runs, **Then**
   it exits with "No LLM provider configured. Pending decisions
   unchanged."
3. **Given** no LLM API key, **When** `valis serve` runs, **Then**
   all core operations (store, search, context, lifecycle) work
   normally — enrichment is fully independent.
4. **Given** enrichment runs, **When** a decision is classified,
   **Then** it is marked with `enriched_by: 'llm'` metadata and an
   audit entry is created.
5. **Given** a daily cost ceiling (configurable, default $1), **When**
   the ceiling is hit, **Then** enrichment stops for the day and
   resumes tomorrow.
6. **Given** `valis enrich --dry-run`, **When** it runs, **Then**
   it shows what would be classified without making changes.

---

### User Story 9 - Pattern Synthesis (Priority: P9)

The team made 7 decisions about the "auth" area this month — all
choosing JWT-based approaches. The pattern synthesis job detects this
cluster and generates an insight: "Team pattern: JWT-based
authentication is the standard approach (7 decisions)." This insight
is stored as a `type: 'pattern'` decision and pushed to active
sessions. The dashboard shows a "Patterns" section with auto-detected
trends.

**Why this priority**: Emergent insights from decision clusters are
the "wow" feature that differentiates Valis from a simple database.
This is the Mímir-inspired "Völva's Vision" — the system discovers
patterns that no individual developer noticed.

**Independent Test**: Store 5+ decisions with `affects: ["auth"]`.
Run pattern synthesis. Verify it detects the cluster and creates a
pattern decision.

**Acceptance Scenarios**:

1. **Given** 3+ active decisions with overlapping `affects` areas
   within a time window, **When** synthesis runs, **Then** a pattern
   is detected and stored as `type: 'pattern'` with
   `source: 'synthesis'`.
2. **Given** a detected pattern, **When** it is stored, **Then**
   active sessions receive a push notification about the new pattern.
3. **Given** the dashboard, **When** patterns exist, **Then** a
   "Patterns" section shows auto-detected trends with decision counts.
4. **Given** synthesis runs twice, **When** the same cluster exists,
   **Then** no duplicate pattern is created (idempotent).
5. **Given** a pattern's source decisions are all deprecated, **When**
   synthesis re-runs, **Then** the pattern is automatically deprecated.
6. **Given** `valis admin patterns`, **When** it runs manually,
   **Then** synthesis executes immediately and reports results.

---

### User Story 10 - Usage-Based Pricing (Priority: P10)

The team has been on the free tier (500 decisions, 5 devs, 100
searches/day). They hit the decision limit. Instead of a hard block,
they see a clear message: "Free tier limit reached (500/500
decisions). Upgrade to Team ($25/mo) for 5,000 decisions, or pay
$0.005 per extra decision." The admin upgrades via a billing portal.
Overage charges are tracked and billed monthly. Usage metrics are
visible in the dashboard.

**Why this priority**: Without billing enforcement, the free tier
limits are decorative. The `rate_limits` table already tracks usage
but nothing enforces limits or charges for overages. This is the
revenue infrastructure.

**Independent Test**: Create a free tier org. Store 501 decisions.
Verify the 501st returns a limit message. Upgrade the org. Verify
the limit increases.

**Acceptance Scenarios**:

1. **Given** a free tier org at 500/500 decisions, **When** a store
   is attempted, **Then** the store is blocked with an upgrade message
   (not a silent failure).
2. **Given** a paid org with overage enabled, **When** they exceed
   their plan limit, **Then** extra decisions are stored and counted
   as overage at the per-unit rate.
3. **Given** an admin, **When** they access the billing portal,
   **Then** they can upgrade plan, view usage, and see invoices.
4. **Given** a paid subscription, **When** the billing cycle ends,
   **Then** overage charges are calculated and billed automatically.
5. **Given** a failed payment, **When** the grace period (7 days)
   expires, **Then** the org is downgraded to free tier limits.
6. **Given** the dashboard, **When** viewing usage, **Then** current
   period's decision count, search count, and remaining quota are
   displayed.

---

### Edge Cases

- What happens when decay makes a critical decision nearly invisible?
  Admin pins it — pinned decisions never decay. The pin action is
  logged in the audit trail.
- What happens when pattern synthesis creates a pattern that
  contradicts an existing decision? Contradiction detection fires
  normally on the synthesized pattern — it's stored via the standard
  pipeline.
- What happens when LLM enrichment misclassifies a decision?
  The `enriched_by: 'llm'` metadata flag allows agents and users to
  know it was auto-classified. Manual reclassification overrides it.
- What happens when cleanup wants to remove a decision that has
  dependents? Decisions with inbound `depends_on` references are
  never auto-deprecated. Flagged for manual review instead.
- What happens when the web dashboard session expires? JWT tokens
  have 1h expiry. The dashboard refreshes the token automatically
  via the exchange-token Edge Function.
- What happens when suppression hides a relevant result? The agent
  receives `suppressed_count` in the response and can request full
  results with the `--all` flag if needed.
- What happens when Stripe webhook delivery fails? Usage metering
  continues locally in `rate_limits`. Billing syncs asynchronously
  on next successful webhook. Operations are never blocked by billing
  failures.
- What happens when Cursor changes its MCP config format?
  Same risk as Claude Code / Codex. Detect format version, degrade
  gracefully, log warning.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support storing decisions with
  `status: 'proposed'` and provide a dedicated review workflow
  (promote to active, or deprecate/reject) via MCP and CLI.
- **FR-002**: System MUST auto-detect Cursor IDE and configure MCP
  server + instruction markers, following the same pattern as Claude
  Code and Codex.
- **FR-003**: System MUST identify and flag near-duplicate decisions
  (content hash match or cosine similarity > 0.9) and stale orphans
  (pending > 30 days) via a cleanup command.
- **FR-004**: Exact-duplicate decisions (same content hash, same org)
  MUST be auto-deprecated. Near-duplicates MUST be flagged for manual
  review, not auto-deprecated.
- **FR-005**: System MUST provide a read-only web dashboard showing
  decisions, search, lifecycle stats, contradictions, proposed queue,
  and team activity — with the same tenant isolation as the CLI.
- **FR-006**: Web dashboard MUST NOT support write operations. All
  mutations happen through CLI or MCP tools.
- **FR-007**: Decision relevance MUST decay over time using a
  configurable half-life (default 90 days). Older decisions rank
  lower in search results.
- **FR-008**: Admins MUST be able to pin decisions. Pinned decisions
  are exempt from decay and always rank at the top of relevant
  searches.
- **FR-009**: Search results MUST be ranked by a composite score
  combining: semantic relevance, BM25 keyword match, recency (decay),
  decision importance (confidence + pin), and graph connectivity
  (dependency count).
- **FR-010**: Reranking MUST add less than 10ms overhead to search
  operations on result sets of up to 50 items.
- **FR-011**: System MUST suppress low-ranking results within the
  same `affects` area when a dominant result exists (>1.5x score).
  Suppressed results accessible via `--all` flag.
- **FR-012**: System MUST provide optional LLM enrichment for
  `type: 'pending'` decisions: classify type, generate summary,
  extract affects. Strictly opt-in with API key configuration.
- **FR-013**: LLM enrichment MUST NOT be required for any core
  operation. Store, search, context, and lifecycle MUST work without
  any LLM configuration.
- **FR-014**: LLM enrichment MUST respect a configurable daily cost
  ceiling (default $1) and stop processing when the ceiling is hit.
- **FR-015**: System MUST detect decision clusters (3+ decisions with
  overlapping `affects` in a time window) and synthesize pattern
  insights without LLM dependency.
- **FR-016**: System MUST enforce plan limits on store and search
  operations. Free tier: 500 decisions, 5 members, 100 searches/day.
- **FR-017**: System MUST support plan upgrades via an external
  billing portal. Overage charges calculated and billed automatically.
- **FR-018**: Billing failures MUST NOT block store or search
  operations. Usage is metered locally and synced asynchronously.
- **FR-019**: Cleanup, enrichment, and synthesis MUST create audit
  entries for all automated actions.

### Key Entities

- **Decision** (extended): Gains `pinned` (boolean, admin-only),
  `enriched_by` (nullable, 'llm' | 'manual'), `decay_score` (computed
  at search time, not stored). `source` enum gains 'synthesis' value.
- **Pattern**: A decision with `type: 'pattern'` and
  `source: 'synthesis'`, linking to the cluster of decisions it was
  derived from.
- **Subscription**: New entity for billing. Links org to plan,
  billing cycle, payment status, and overage tracking.

## Clarifications

### Session 2026-03-24

- Q: How does a user authenticate in the web dashboard (browser)? → A: Phase 3: API key entry → exchange-token → JWT (reuses existing infra, simplest). Phase 4B: upgrade to Device Authorization Grant (RFC 8628) for better UX.

## Assumptions

- Cursor uses `~/.cursor/` for configuration and `.cursorrules` for
  agent instructions, following a similar pattern to Codex's
  `.codex/` and `AGENTS.md`.
- Web dashboard is hosted separately (e.g., Vercel). Auth: user enters
  member API key → dashboard calls exchange-token → JWT for all queries.
  No new auth system needed. Device Authorization Grant (RFC 8628) is
  a Phase 4B upgrade for better UX.
- LLM enrichment uses lightweight models (Haiku, GPT-4o-mini) to
  minimize cost. Multi-provider support (Anthropic, OpenAI) is
  required. Local models (Ollama) are a stretch goal.
- Pattern synthesis uses `affects` area overlap and decision
  frequency — no LLM needed. Satisfies Constitution Principle IV.
- Usage-based pricing uses an external billing provider (e.g.,
  Stripe). The system tracks usage locally and syncs asynchronously.
- Decay half-life (90 days) and suppression threshold (1.5x score)
  are configurable per-org. Defaults chosen based on Mímir research.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Proposed decisions are visible in search and dashboard
  within 1 second of being stored.
- **SC-002**: Cursor IDE integration works end-to-end (init → serve →
  store → search) with zero manual configuration beyond `valis init`.
- **SC-003**: Cleanup identifies 95%+ of exact duplicates and flags
  90%+ of near-duplicates (measured against a test corpus).
- **SC-004**: Web dashboard loads decision list and stats within 3
  seconds on first visit. Subsequent navigation within 1 second.
- **SC-005**: A 90-day-old decision ranks measurably lower than an
  equivalent 1-day-old decision in search results.
- **SC-006**: Multi-signal reranking improves search relevance by
  20%+ over the current single-signal ranking (measured against a
  golden test set of 50 query-result pairs).
- **SC-007**: Suppression reduces average result set size by 30-50%
  without hiding results that users would consider relevant.
- **SC-008**: LLM enrichment classifies 90%+ of pending decisions
  correctly (type, summary quality) at a cost of <$0.01 per decision.
- **SC-009**: Pattern synthesis detects 80%+ of decision clusters
  (3+ decisions in the same area) without false positives on
  unrelated decisions.
- **SC-010**: Free tier limits are enforced — the 501st decision on a
  free plan returns a clear upgrade message. Paid plan overages are
  tracked accurately.
- **SC-011**: Existing MVP and Phase 2 installations continue to
  function without changes after Phase 3 deployment (backward
  compatibility).
