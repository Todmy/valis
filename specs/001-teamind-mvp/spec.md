# Feature Specification: Teamind MVP

**Feature Branch**: `001-teamind-mvp`
**Created**: 2026-03-22
**Status**: Draft
**Input**: Design specifications, implementation plans, and user stories from `docs/`

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organization Setup & Team Onboarding (Priority: P1)

A Tech Lead runs a single command to create a shared team brain.
The command creates an organization, auto-detects installed AI coding
tools (Claude Code, Codex), configures them to use Teamind, injects
instructions that tell agents to store and search decisions, and seeds
the brain with existing knowledge extracted from project files and git
history. The Tech Lead receives an invite code and shares it with their
team. A Developer runs the same command with the invite code to join
the org and gets the same automatic IDE configuration.

**Why this priority**: Nothing works without an organization. This is the
entry point for every user. If onboarding takes more than 3 minutes or
requires manual config editing, adoption drops to zero.

**Independent Test**: Run the init command on a fresh machine with
Claude Code installed. Verify: org is created, IDE is configured, agent
instructions are injected, existing decisions are seeded. Share the
invite code, join from a second machine, verify shared access.

**Acceptance Scenarios**:

1. **Given** a developer with Claude Code installed, **When** they run
   `teamind init`, **Then** an organization is created, IDE is
   configured, and an invite code is displayed — all in under 3 minutes.
2. **Given** an existing org with invite code `ACME-7X3K`, **When** a
   teammate runs `teamind init --join ACME-7X3K`, **Then** they join
   the org and see "47 decisions already available."
3. **Given** a project with CLAUDE.md, AGENTS.md, and git history,
   **When** init runs seed extraction, **Then** 15-30 decisions are
   extracted and stored with `source: seed`.
4. **Given** Claude Code and Codex are installed, **When** init
   auto-detects them, **Then** MCP server config is added to both IDEs
   and agent instruction markers are injected into CLAUDE.md/AGENTS.md.
5. **Given** init has already been run, **When** the user runs it again,
   **Then** no duplicate entries are created (idempotent).

---

### User Story 2 - Decision Capture (Priority: P2)

Developers work with their AI agents as usual. Teamind automatically
captures decisions through multiple layers without manual effort:

1. **CLAUDE.md keyword triggers + explicit store (baseline)**: Agent
   stores decisions proactively based on CLAUDE.md instructions, or
   when the user says "запам'ятай", "збережи", "remember this", or
   "store this". Works without any channel support. ~30-50% capture.
2. **Channel reminders (enhancement)**: If channels are available,
   Teamind monitors transcript activity. After significant work
   (15+ min of activity, or session end), it sends a reminder to the
   agent. The agent summarizes and stores classified decisions. ~80%+
   capture. Graceful fallback to baseline if channels unavailable.
3. **Startup sweep (catch-up)**: On every Teamind launch, unprocessed
   transcript content is scanned and stored.

All captured decisions include type (decision/constraint/pattern/lesson),
summary, and affected areas when the agent provides them.

**Why this priority**: Capture is the core value. Without it, the brain
is empty. Auto-capture removes the biggest adoption barrier — manual
effort.

**Independent Test**: Start a coding session with Teamind running. Make
architectural decisions during the session. After the session, verify
that decisions were captured automatically without any manual action.

**Acceptance Scenarios**:

1. **Given** Teamind is running and the developer is coding, **When**
   15+ minutes of activity occur, **Then** the agent receives a capture
   reminder and stores classified decisions.
2. **Given** a running session, **When** the user says "запам'ятай: ми
   вирішили використовувати PostgreSQL", **Then** the agent stores this
   as a decision via `teamind_store`.
3. **Given** the agent makes a technical decision, **When** it calls
   `teamind_store` with text, type, summary, and affects, **Then** the
   decision is stored and confirmed within 200ms.
4. **Given** a session ends via stop hook, **When** the hook fires,
   **Then** the agent receives a final capture reminder to store
   remaining decisions.
5. **Given** a developer had sessions while Teamind was not running,
   **When** Teamind starts, **Then** startup sweep processes missed
   transcripts and stores extracted decisions.
6. **Given** content that matches a secret pattern (API keys, tokens),
   **When** a store is attempted, **Then** the entire record is blocked
   with error: "secret_detected."
7. **Given** the same decision is captured by multiple layers, **When**
   deduplication runs, **Then** only one copy is stored (content hash +
   session_id).

---

### User Story 3 - Decision Search & Context (Priority: P3)

AI agents search the team brain before making architectural choices.
When a developer starts a new task, the agent loads relevant prior
decisions. When the user asks "як ми вирішили?", "what did we decide?",
or "find decisions about auth", the agent searches automatically.

An Eng Manager can also search from the terminal without opening an IDE.

**Why this priority**: Capture without retrieval is a write-only log.
Search closes the loop — decisions made by one developer inform every
other developer's agent.

**Independent Test**: Dev A stores "We chose PostgreSQL for user data."
Dev B's agent searches "database choice for user data" and finds the
PostgreSQL decision.

**Acceptance Scenarios**:

1. **Given** stored decisions about auth, **When** the agent calls
   `teamind_search({query: "authentication"})`, **Then** relevant auth
   decisions are returned ranked by relevance.
2. **Given** a new task about payments, **When** the agent calls
   `teamind_context({task_description: "implement payment flow"})`,
   **Then** relevant constraints and decisions about payments are
   returned grouped by type.
3. **Given** a first-ever context call in a session, **When** the agent
   calls `teamind_context`, **Then** the response includes "N total
   decisions in team brain" as an orientation note.
4. **Given** the user says "знайди рішення про базу даних", **When**
   the agent recognizes the keyword trigger, **Then** it auto-calls
   `teamind_search` and presents results.
5. **Given** an Eng Manager in a terminal, **When** they run
   `teamind search "authentication" --type decision`, **Then** matching
   decisions are displayed with type, summary, author, and date.

---

### User Story 4 - Real-Time Team Awareness (Priority: P4)

When Dev A stores a decision, all other active Teamind sessions receive
a push notification. Dev B's agent sees the new decision in context
without calling search. This creates real-time team awareness — no one
works in a silo.

**Why this priority**: Push completes the "shared brain" vision. Without
it, agents only learn about team decisions when they explicitly search.
With it, new decisions flow to everyone immediately.

**Independent Test**: Dev A stores a decision. Dev B (on a different
machine, same org) sees the decision appear in their active session
without searching.

**Acceptance Scenarios**:

1. **Given** Dev A and Dev B are in the same org with active sessions,
   **When** Dev A stores a decision, **Then** Dev B's session receives
   a notification with the decision summary, author, and type.
2. **Given** a session without channel support, **When** a teammate
   stores a decision, **Then** the session works normally — no push, but
   pull-based tools still function.
3. **Given** the push mechanism fails, **When** a decision is stored,
   **Then** the store still succeeds and the decision is available via
   search.

---

### User Story 5 - Security (Priority: P5)

Teamind blocks storage of any text containing secrets (API keys, tokens,
passwords, private keys). Tenants are fully isolated — one organization
cannot see another's decisions through any operation (store, search,
export).

**Why this priority**: A tool that leaks secrets or crosses org
boundaries is a liability, not an asset. Security is a prerequisite for
any production deployment.

**Independent Test**: Attempt to store text containing an AWS access key.
Verify it's blocked. Create two orgs, store decisions in each, verify
cross-org search returns zero results.

**Acceptance Scenarios**:

1. **Given** text containing `sk-ant-api03-...` (Anthropic API key),
   **When** a store is attempted, **Then** the entire record is blocked
   with `{error: "secret_detected", pattern: "Anthropic API Key"}`.
2. **Given** 10 defined secret patterns (AWS, OpenAI, GitHub, private
   keys, JWT, DB URLs, Slack, Stripe, generic secrets), **When** any
   pattern matches, **Then** storage is blocked across all capture layers.
3. **Given** Org A and Org B each with stored decisions, **When** Org A
   searches for any query, **Then** zero results from Org B are returned.
4. **Given** API key authentication, **When** any request is made,
   **Then** the API key maps to exactly one org, and all operations are
   scoped to that org.
5. **Given** config files with API keys, **When** they are written to
   disk, **Then** file permissions are set to 0600 (owner read/write
   only).

---

### User Story 6 - CLI Management (Priority: P6)

The Eng Manager and Tech Lead can check system health, view team
activity dashboards, export decisions, and manage configuration — all
from the terminal.

**Why this priority**: Managers need visibility without opening an IDE.
Export enables external analysis and reporting. Status enables
troubleshooting.

**Independent Test**: Run `teamind status` and verify connectivity
checks. Run `teamind dashboard` and verify aggregated stats. Run
`teamind export --json` and verify valid output.

**Acceptance Scenarios**:

1. **Given** a configured Teamind installation, **When** the user runs
   `teamind status`, **Then** they see: cloud connectivity (OK/degraded/
   broken), org name, decision count, pending queue count, and
   configured IDEs — in under 2 seconds.
2. **Given** an org with 50+ decisions, **When** the user runs
   `teamind dashboard`, **Then** they see: total count, breakdown by
   type, by author, recent decisions, and pending enrichments.
3. **Given** an org with decisions, **When** the user runs
   `teamind export --json`, **Then** a valid JSON file is produced
   with all decision fields (type, summary, detail, author, date,
   affects).
4. **Given** an org with decisions, **When** the user runs
   `teamind export --markdown`, **Then** a Markdown file is produced
   with decisions grouped by type.
5. **Given** the user wants to change their API key, **When** they run
   `teamind config set api-key <key>`, **Then** the key is validated
   and saved.

---

### User Story 7 - Offline Resilience (Priority: P7)

When the developer is offline or the cloud is unreachable, store
operations queue locally and sync when connectivity returns. Search
operations return empty results gracefully — no errors, no crashes,
no blocking. The developer's workflow is never interrupted.

**Why this priority**: Developers work on planes, trains, and flaky
WiFi. A tool that breaks offline destroys trust.

**Independent Test**: Disconnect from the internet. Store a decision —
verify it queues locally. Search — verify empty results returned. Go
online — verify queued decisions sync.

**Acceptance Scenarios**:

1. **Given** no internet connection, **When** the agent calls
   `teamind_store`, **Then** the decision is queued to local storage
   and the agent receives `{stored: true, synced: false}`.
2. **Given** no internet connection, **When** the agent calls
   `teamind_search`, **Then** it receives `{results: [], offline: true}`
   — no error thrown.
3. **Given** queued offline decisions, **When** connectivity returns,
   **Then** the queue is flushed and all decisions are synced to cloud.
4. **Given** a partial failure (one storage backend succeeds, one fails),
   **When** the successful write completes, **Then** the failed write is
   retried — no data is lost.
5. **Given** offline state, **When** the user runs `teamind status`,
   **Then** the pending queue count is shown.

---

### User Story 8 - Clean Uninstall & Error Messages (Priority: P8)

A developer can cleanly remove all Teamind local configuration with a
single command. Every error the user encounters includes what happened,
why, and how to fix it.

**Why this priority**: Reversibility builds trust — users try tools
more readily when they know removal is clean. Clear errors reduce
support burden.

**Independent Test**: Run `teamind uninstall`. Verify all IDE configs,
CLAUDE.md markers, and local files are removed. Trigger each error
condition and verify the message includes action steps.

**Acceptance Scenarios**:

1. **Given** Teamind is installed with Claude Code and Codex configured,
   **When** the user runs `teamind uninstall`, **Then** MCP configs are
   removed from both IDEs, CLAUDE.md markers are removed, and
   `~/.teamind/` is deleted.
2. **Given** uninstall completes, **When** the user checks IDE configs,
   **Then** no Teamind artifacts remain.
3. **Given** uninstall runs, **Then** the user is warned: "Cloud data
   preserved. Contact org admin to delete."
4. **Given** the cloud is unreachable during store, **When** the error
   occurs, **Then** the message reads: "Cloud unreachable. Decision
   queued locally (3 pending). Will sync automatically."
5. **Given** an invalid invite code, **When** join is attempted, **Then**
   the message reads: "Invalid invite code. Ask your team lead for a
   valid code."
6. **Given** the free tier limit is hit, **When** a store is attempted,
   **Then** the message includes both upgrade and prune options.

---

### Edge Cases

- What happens when two developers store contradicting decisions
  simultaneously? Both are stored; contradiction detection is Phase 2.
- What happens when the JSONL transcript format changes between IDE
  versions? The parser degrades gracefully — unparseable lines are
  skipped, and a warning is logged.
- What happens when multiple `teamind serve` processes run for the same
  user? Content hash + session_id dedup prevents duplicate decisions.
- What happens when the invite code is shared publicly? Anyone with the
  code can join. Org admins can rotate the code and remove members.
- What happens when a decision is stored with no type/summary/affects?
  It's stored as `type: 'pending'` with raw text — still searchable.
- What happens when the Qdrant free tier limit is reached? Store
  succeeds in the relational database (source of truth). Vector search
  write fails and is retried. Search degrades but doesn't crash.
- What happens on WSL2 where file watching is unreliable? Chokidar
  handles it via polling fallback. If watcher fails entirely, log
  warning and rely on MCP-only capture + startup sweep.
- What happens when Claude Code cleans up transcripts after 30 days
  (default cleanupPeriodDays)? `teamind init` sets cleanupPeriodDays
  to 99999 to prevent this. If transcripts are already deleted,
  startup sweep finds nothing — no crash.
- What happens when the file watcher reads a partial JSONL line
  (file still being written)? Buffer the incomplete line, process
  only complete lines terminated by newline. awaitWriteFinish option
  in chokidar provides 300ms stability threshold.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow creating an organization via a single CLI
  command, returning an org identifier, API key, and invite code.
- **FR-002**: System MUST allow joining an organization using an invite
  code, granting immediate access to all existing decisions.
- **FR-003**: System MUST auto-detect installed AI coding tools (Claude
  Code, Codex) and configure MCP server entries without manual editing.
- **FR-004**: System MUST inject agent instruction markers into
  CLAUDE.md / AGENTS.md between delimited markers, idempotently.
- **FR-005**: System MUST seed the team brain on init by extracting
  decisions from CLAUDE.md, AGENTS.md, and git log.
- **FR-006**: System MUST provide an MCP tool (`teamind_store`) to
  store decisions with optional type, summary, and affected areas.
- **FR-007**: System MUST provide an MCP tool (`teamind_search`) for
  hybrid search across team decisions, returning ranked results.
- **FR-008**: System MUST provide an MCP tool (`teamind_context`) to
  load relevant decisions for a given task description and file list.
- **FR-009**: System MUST auto-capture decisions by monitoring transcript
  activity and sending channel reminders to agents.
- **FR-010**: System MUST process missed transcripts on startup before
  entering the MCP event loop.
- **FR-011**: System MUST block storage of text matching any of 10
  defined secret patterns, rejecting the entire record.
- **FR-012**: System MUST enforce tenant isolation — all queries scoped
  to the authenticated organization.
- **FR-013**: System MUST write to two storage backends (relational
  database as source of truth, vector database as search layer) for
  every store operation.
- **FR-014**: System MUST queue store operations locally when cloud is
  unreachable and sync on reconnect.
- **FR-015**: System MUST return empty results (not errors) for search
  operations when offline.
- **FR-016**: System SHOULD push new decisions to active sessions in
  the same org via channel notifications. MVP: local session push only.
  Cross-session broadcast (Dev A → Dev B) via Supabase Realtime is
  Phase 2.
- **FR-017**: System MUST provide CLI commands: status, dashboard,
  export (JSON + Markdown), config, and uninstall.
- **FR-018**: System MUST deduplicate decisions across capture layers
  using content hash + session identifier.
- **FR-019**: System MUST install via npm without native compilation on
  macOS (ARM64/Intel) and Linux x64.
- **FR-020**: System MUST provide actionable error messages that include
  what happened, why, and how to fix.
- **FR-021**: Uninstall MUST remove all IDE configurations, agent
  instruction markers, and local state — using a manifest to track what
  was created.

### Key Entities

- **Organization**: A team's shared brain space. Has a name, API key,
  invite code, billing plan, and member list. One org = one isolated
  tenant.
- **Member**: A person belonging to an organization. Has a role (admin
  or member), author name, and join date.
- **Decision**: The core data object. Types: decision, constraint,
  pattern, lesson, or pending. Has full text detail, optional summary,
  status (active/deprecated/superseded/proposed), author, source
  (mcp_store/file_watcher/stop_hook/seed), affected areas, confidence
  score, and timestamps. Belongs to one organization.

## Assumptions

- Claude Code supports MCP stdio transport and channel push (v2.1.80+).
- Codex supports MCP configuration via config files.
- Cursor integration is deferred to Phase 2.
- Contradiction detection is deferred to Phase 2.
- Decision relationships (depends_on, replaces) are deferred to Phase 2.
- The team brain dashboard is CLI-only in MVP; web dashboard is a future
  cloud feature.
- The free tier has reasonable limits (500 decisions, 5 devs,
  100 searches/day) per v5 pricing table.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user completes organization setup, IDE configuration,
  and seed extraction in under 3 minutes.
- **SC-002**: Installation succeeds without native compilation errors on
  macOS ARM64, macOS Intel, and Linux x64.
- **SC-003**: Developer A stores a decision, Developer B on a different
  machine finds it via search — cross-machine sync works.
- **SC-004**: Seed extraction produces 15+ decisions from a typical
  project with CLAUDE.md and git history, completing in under 10 seconds.
- **SC-005**: Search for a known keyword (e.g., "authentication") returns
  the relevant decision in the top 3 results.
- **SC-006**: Auto-capture produces classified decisions from 80%+ of
  active coding sessions without manual developer action.
- **SC-007**: Store operations complete in under 200ms from the agent's
  perspective.
- **SC-008**: The system functions normally (no crashes, no blocking)
  when cloud is unreachable — stores queue, searches return empty.
- **SC-009**: Secret detection blocks 100% of test patterns (10 defined
  categories) with zero false negatives on known patterns.
- **SC-010**: Uninstall cleanly removes all local artifacts with no
  IDE configuration remnants.
- **SC-011**: Every user-facing error message includes what happened,
  why, and how to fix — verified against all 7 defined error categories.
- **SC-012**: Dashboard displays team activity (total decisions, by type,
  by author, recent activity) within 2 seconds.
