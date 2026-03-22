# Teamind MVP — User Stories

**Date:** 2026-03-18
**Scope:** Phase 1 (MVP, weeks 1-8)
**Spec:** teamind-design-spec-v5.md

---

## Personas

| Persona | Description |
|---------|-------------|
| **Tech Lead (Olena)** | Leads 5-dev team, 80% AI-assisted. Needs visibility into what agents decide. Creates org, onboards team. |
| **Developer (Andriy)** | Day-to-day coder with Claude Code/Codex. Wants prior decisions available automatically, not manual search. |
| **Eng Manager (Viktor)** | Manages 3 squads (15 devs). Wants aggregated view: what's decided, where are gaps. |
| **AI Agent** | Claude Code / Codex session. Stores and retrieves decisions via MCP tools. Classifies decisions at store time when instructed. |

---

## Epic 1: Organization Setup

### US-1.1: Create organization
**As** Olena (Tech Lead),
**I want** to run `teamind init` and create a new org in under 3 minutes,
**so that** my team has a shared knowledge space from Day 1.

**Acceptance:**
- Interactive prompt: org name → create → returns org_id + API key + invite code
- Org created via Supabase Edge Function (create-org)
- Config saved to `~/.teamind/config.json` (0600 permissions)
- Invite code displayed and copyable (format: `XXXX-XXXX`)

### US-1.2: Join existing organization
**As** Andriy (Developer),
**I want** to run `teamind init --join ACME-7X3K` with my team's invite code,
**so that** I instantly access all existing team decisions.

**Acceptance:**
- Validates invite code via Supabase Edge Function (join-org) → joins org
- Shows count of existing decisions ("47 decisions already available")
- Same IDE config flow as org creator
- Fails clearly on invalid/expired code

### US-1.3: Auto-detect and configure IDEs
**As** Olena or Andriy,
**I want** init to automatically configure my installed IDEs for Teamind,
**so that** I don't manually edit MCP configs.

**Acceptance:**
- Detects installed: Claude Code, Codex (Cursor → Phase 2)
- Adds MCP server config to each detected IDE
- Injects teamind instruction block into CLAUDE.md / AGENTS.md (between `<!-- teamind:start -->` / `<!-- teamind:end -->` markers)
- Instructions tell agent to include type, summary, affects when storing
- Creates project-level config file if none exists; appends to existing; never modifies parent-level
- Idempotent: re-running doesn't duplicate entries

---

## Epic 2: Decision Capture

### US-2.1: Channel-driven capture reminders
**As** Andriy,
**I want** Teamind to periodically remind my agent to store important decisions,
**so that** I get high-quality captured decisions without doing anything manually.

**Acceptance:**
- Activity watcher monitors `~/.claude/projects/` for JSONL changes (detects work activity)
- After significant activity (15 min debounce), pushes channel reminder to agent
- Agent reviews recent work with full context and calls `teamind_store` with type, summary, affects
- Captured decisions are high-quality (agent-classified, not raw text noise)
- Dedup by content hash + session_id
- Non-blocking: if watcher or channel fails, IDE works normally
- Graceful fallback: without channel, CLAUDE.md keyword triggers still capture ~30-50%

### US-2.2: Session-end capture reminder (Stop Hook)
**As** Andriy,
**I want** Teamind to remind my agent to store decisions when my session ends,
**so that** nothing is lost at the end of a work session.

**Acceptance:**
- HTTP handler on localhost receives stop hook event
- Pushes channel reminder: "Session ending — store any remaining decisions"
- Agent reviews session and stores important decisions via `teamind_store`
- Non-blocking: if hook doesn't fire (30-40% miss rate), activity watcher + keyword triggers cover

### US-2.3: Startup sweep for missed sessions
**As** Andriy,
**I want** Teamind to catch up on sessions I had while it wasn't running,
**so that** no decisions are lost even if I forgot to start Teamind.

**Acceptance:**
- On every `teamind serve` launch, scans `~/.claude/projects/` for unprocessed JSONL content
- Processes content modified since last processed timestamp
- Dual writes decisions before entering MCP event loop
- Handles gracefully: empty files, corrupt JSONL, already-processed content

### US-2.4: Explicit store via MCP tool (structured) + keyword triggers
**As** an AI Agent,
**I want** to call `teamind_store` when I make a decision, OR when the user says trigger words, OR when I receive a capture reminder,
**so that** the team brain captures classified decisions from all paths.

**Acceptance:**
- Input: `{text: string, type?: string, summary?: string, affects?: string[]}` (text min 10 chars)
- Three triggers for `teamind_store`:
  1. Agent decides proactively (CLAUDE.md instructions)
  2. User says keywords: "запам'ятай", "збережи", "remember this", "store this"
  3. Channel capture reminder arrives (from activity watcher or stop hook)
- Agent provides type/summary/affects with full session context
- Secret detection runs before storage → blocks if pattern matched
- Dual write: INSERT Postgres + UPSERT Qdrant → returns `{id, status: "stored"}` in <200ms
- If cloud unreachable → queues to `~/.teamind/pending.jsonl`, returns `{stored: true, synced: false}`

### US-2.5: Real-time decision broadcast (Channel push)
**As** an AI Agent in Dev B's session,
**I want** to automatically receive decisions made by Dev A's agent in real-time,
**so that** I have up-to-date team context without explicitly searching.

**Acceptance:**
- When Dev A stores a decision, all other connected Teamind sessions receive a push notification
- Notification appears as `<channel source="teamind" event="new_decision" author="dev_a">` in context
- Agent reads the notification and incorporates into current task context
- Non-blocking: if channel push fails, store still succeeds
- Graceful degradation: sessions without channel support work normally via pull-based tools
- Requires Claude Code v2.1.80+ and `--channels` flag

---

## Epic 3: Decision Search & Context

### US-3.1: Search team decisions (with keyword triggers)
**As** an AI Agent,
**I want** to call `teamind_search` before making architectural choices, AND when the user says search-related words,
**so that** I don't contradict or duplicate existing team decisions.

**Acceptance:**
- Input: `{query: string, type?: string, limit?: number}`
- Auto-triggered by user keywords: "знайди", "пошукай", "згадай", "як ми вирішили", "remember", "recall", "find", "what did we decide"
- Also triggered proactively before architectural choices (CLAUDE.md instructions)
- Qdrant hybrid search: dense vectors (MiniLM 384d) + BM25 sparse + org_id filter
- Returns `[{decision, score, type, summary, affects}]` ranked by relevance
- Offline: returns `{results: [], offline: true}` — agent proceeds without context

### US-3.2: Load context for current task
**As** an AI Agent,
**I want** to call `teamind_context` at the start of a task,
**so that** I have all relevant prior decisions loaded before I begin.

**Acceptance:**
- Input: `{task_description: string, files?: string[]}`
- Searches by task description + file names via Qdrant
- Returns relevant decisions grouped by type + summary of key constraints
- First call in session includes: "N total decisions in team brain. Use teamind_search for specific queries."
- Offline: empty results, no crash

### US-3.3: Search from CLI
**As** Viktor (Eng Manager),
**I want** to run `teamind search "authentication"` from terminal,
**so that** I can check what my team decided about auth without opening an IDE.

**Acceptance:**
- Searches via Qdrant, displays formatted results
- Shows: type, summary, author, date, confidence
- Filters: `--type decision`, `--limit 5`

---

## Epic 4: Seed-on-Init

### US-4.1: Seed from existing project files
**As** Olena,
**I want** init to extract existing decisions from my project's CLAUDE.md, AGENTS.md, and git log,
**so that** the team brain has useful content from Day 1 — not an empty database.

**Acceptance:**
- Parses: CLAUDE.md, AGENTS.md, git log (recent meaningful commits)
- Extracts 15-30 decisions from typical project
- Dual write to Postgres + Qdrant (seed stored as `source: 'seed'`, `type: 'pending'`)
- Init returns in <10 seconds
- Shows count: "Seeded 21 decisions"

---

## Epic 5: Security

### US-5.1: Secret detection before storage
**As** Andriy,
**I want** Teamind to block storage of any text containing API keys or secrets,
**so that** sensitive credentials never reach the cloud.

**Acceptance:**
- 10 regex patterns checked before any store operation (AWS, Anthropic, OpenAI, GitHub, private keys, JWT, DB URLs, Slack, Stripe, generic secrets)
- Entire record blocked (not redacted)
- Agent receives: `{error: "secret_detected", pattern: "Anthropic API Key", action: "blocked"}`
- Applies to all capture layers (MCP store, file watcher, stop hook)

### US-5.2: Tenant isolation
**As** Viktor,
**I want** my org's decisions to be completely isolated from other orgs,
**so that** our proprietary architectural decisions aren't visible to others.

**Acceptance:**
- Qdrant: single collection with `org_id` indexed payload field, all queries filter by org_id
- Postgres: Row Level Security on decisions table by org_id
- API key maps to org_id — validated on every request
- No cross-org data leakage possible through search, store, or export

---

## Epic 6: Offline & Resilience

### US-6.1: Offline queue for stores
**As** Andriy,
**I want** decisions to queue locally when I'm offline,
**so that** nothing is lost and everything syncs when I reconnect.

**Acceptance:**
- If Supabase or Qdrant unreachable: append to `~/.teamind/pending.jsonl`
- Returns `{stored: true, synced: false}` to agent
- Flushes queue on next successful connection
- Shows pending count in `teamind status`

### US-6.2: Graceful degradation for search
**As** an AI Agent,
**I want** search/context to return empty results when offline (not crash),
**so that** I can proceed with my task even without team context.

**Acceptance:**
- Returns `{results: [], offline: true, note: "Cloud unavailable."}`
- Agent continues normally — no error thrown
- No retry loops or hangs

### US-6.3: Partial failure handling (dual write)
**As** the system,
**I want** to handle cases where Postgres succeeds but Qdrant fails (or vice versa),
**so that** data is never lost.

**Acceptance:**
- If Postgres succeeds, Qdrant fails: decision is safe in Postgres, queue Qdrant upsert for retry
- If Qdrant succeeds, Postgres fails: log warning, retry Postgres insert
- `teamind status` shows sync state between Postgres and Qdrant

---

## Epic 7: CLI Management

### US-7.1: Check system health
**As** Olena,
**I want** to run `teamind status` to see if everything is working,
**so that** I can troubleshoot issues quickly.

**Acceptance:**
- Shows: Supabase connectivity, Qdrant connectivity, org name, decision count, pending queue count, configured IDEs
- Color-coded: green (OK), yellow (degraded), red (broken)
- Runs in <2 seconds

### US-7.2: View team dashboard
**As** Viktor,
**I want** to run `teamind dashboard` to see aggregated team activity,
**so that** I have a high-level view of what my team is deciding.

**Acceptance:**
- Queries Postgres: total decisions, by type, by author, by date (last 7d/30d), recent decisions list
- Formatted table in terminal
- Refreshes on each call (not cached)

### US-7.3: Export decisions
**As** Viktor,
**I want** to run `teamind export --json` to get all team decisions in a portable format,
**so that** I can analyze them externally or create reports.

**Acceptance:**
- Queries Postgres (source of truth) for all org decisions
- Formats: `--json` (array of Decision objects), `--markdown` (grouped by type)
- Outputs to stdout (pipe-friendly) or `--output file.json`
- Includes all fields: type, summary, detail, author, date, confidence, affects

### US-7.4: Clean uninstall
**As** Andriy,
**I want** to run `teamind uninstall` to cleanly remove all local configs,
**so that** my machine is clean if I stop using Teamind.

**Acceptance:**
- Removes: MCP configs from IDEs, CLAUDE.md/AGENTS.md teamind markers, `~/.teamind/` directory
- Uses manifest (`~/.teamind/manifest.json`) to track what was created during init
- Warns: "Cloud data preserved. Contact org admin to delete."
- Confirms before proceeding

---

## Epic 8: Error Handling

### US-8.1: Clear error messages for all failure modes
**As** Andriy or Olena,
**I want** clear, actionable error messages when something goes wrong,
**so that** I can fix issues myself without reading source code.

**Acceptance:**
- Defined error messages (per spec Section 13):
  - Cloud unreachable → pending count + auto-sync note
  - Org not found → init instructions
  - Invite code invalid → ask team lead
  - Free tier limit → upgrade or prune options
  - Secret detected → pattern name + "remove and retry"
  - Qdrant unreachable → data safe in Postgres note
  - Dual write partial failure → what's safe, what needs retry
- Every error includes: what happened, why, how to fix

---

## Story Map (priority order within MVP)

```
                    Olena (Tech Lead)          Andriy (Developer)         Viktor (Eng Manager)      AI Agent
                    ─────────────────          ──────────────────         ─────────────────────      ────────
Week 1-2  Setup     US-1.1 Create org          US-1.2 Join org
                    US-1.3 IDE config
                    US-4.1 Seed-on-init

Week 2-4  Capture                              US-2.1 JSONL watcher                                 US-2.4 MCP store
                                               US-2.2 Stop hook                                      US-2.5 Channel push
                                               US-2.3 Startup sweep

Week 4-5  Search                                                          US-3.3 CLI search          US-3.1 Search
                                                                                                     US-3.2 Context

Week 5-6  Secure   US-5.1 Secret detection
                   US-5.2 Tenant isolation

Week 6-7  Manage   US-7.1 Status               US-7.4 Uninstall          US-7.2 Dashboard
                                                                          US-7.3 Export

Week 6-7  Resilience                            US-6.1 Offline queue
                                                US-6.2 Graceful search
                                                US-6.3 Partial failure

Week 7-8  Polish   US-8.1 Error messages
```
