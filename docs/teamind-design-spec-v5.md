# Teamind — Design Specification v5

**Date:** 2026-03-18
**Status:** Final — evolved from v4 with revised stack (Supabase + Qdrant, no Cloudflare, no LLM enrichment in MVP)
**Identity:** Team Brain from Day 1
**License:** Apache 2.0 (monetize cloud, not license)

---

## 1. Product Overview

**Teamind** — shared decision intelligence for AI-augmented engineering teams.

**One-liner:** Your team's AI agents share one brain. Decisions made in one session are available in every session, for every developer.

**Problem:** AI team of 5 devs generates decisions at a pace no engineering manager can track. Who decided what? Does it contradict yesterday? What's the full picture?

**Target:** Engineering Manager / Tech Lead / CTO. Teams 15-50 devs, 50%+ using AI agents daily.

**Differentiator vs memctl:** memctl = flat text memory. Teamind = typed decision objects (decision/constraint/pattern/lesson) with agent-driven classification, Qdrant hybrid search (dense + BM25), dual storage (Postgres + Qdrant), and team-wide shared context.

---

## 2. Architecture

### Core Principles

1. **Cloud-first** — team sync, org management, shared storage from Day 1
2. **Minimally invasive** — pure MCP, no proxy, no stream interception
3. **Non-blocking** — if Teamind fails, IDE works normally
4. **No LLM dependency in MVP** — agent classifies at store time; auto-capture stores raw text; hybrid search handles both
5. **Zero native dependencies** — pure JS/TS npm package, no compilation
6. **Auto-capture by default** — three capture layers in one process, user does nothing
7. **Dual storage** — Postgres = source of truth, Qdrant = search layer
8. **Push + Pull** — hybrid MCP+Channel server: tools for on-demand access, channel for real-time team notifications

### Capture Architecture: Channel-Driven + Explicit Store

Two capture mechanisms, both producing **high-quality classified decisions**:

| Layer | Mechanism | Coverage | Quality |
|-------|-----------|----------|---------|
| **1. Channel Capture Reminder** (primary) | JSONL watcher detects activity → pushes channel reminder to agent → agent summarizes and calls `teamind_store` with full context | ~80-90% (Claude Code sessions with channel) | High (agent has full session context, classifies at store time) |
| **2. MCP teamind_store** (explicit) | Agent calls tool proactively when instructed via CLAUDE.md / AGENTS.md, or when user says trigger words | ~30-50% (boosted by keyword triggers) | Highest (agent curated + classified) |

**How Channel Capture Reminder works:**
1. JSONL file watcher monitors `~/.claude/projects/` for transcript activity
2. After detecting significant new content (e.g., 15+ minutes of activity, or session end via stop hook), Teamind pushes a channel notification:
   ```xml
   <channel source="teamind" event="capture_reminder">
   Review your recent work. If any decisions, constraints, patterns, or lessons
   were established, store them via teamind_store with type, summary, and affects.
   </channel>
   ```
3. The agent — which has full session context — summarizes and calls `teamind_store` with structured data
4. Result: high-quality, classified decisions instead of raw text noise

**Why this is better than raw transcript parsing:**
- Agent already has full context — no need for keyword heuristics or LLM enrichment
- Zero additional cost — the agent is already running
- Structured output (type, summary, affects) — not raw text blobs
- Signal-to-noise ratio is dramatically higher — agent knows what's a decision vs conversation

**Fallback:** If channel isn't active (no `--channels` flag), CLAUDE.md keyword triggers + explicit `teamind_store` instructions still capture ~30-50% of decisions. Startup sweep processes any missed sessions.

**Startup sweep:** On every `teamind serve` launch, BEFORE entering MCP event loop:

### Real-Time Push: Channel Capability

Teamind is a **hybrid MCP + Channel server**. Beyond pull-based tools, it pushes real-time events into running sessions:

```ts
capabilities: {
  tools: {},                                    // standard MCP tools
  experimental: { 'claude/channel': {} },       // channel push capability
}
```

**What gets pushed:**
- New decisions stored by other team members → immediate context for current session
- Contradiction alerts → "Decision #47 contradicts your active decision #12"
- Team activity signals → "3 new decisions about auth module today"

**How it works:**
1. Dev A stores decision via `teamind_store`
2. Teamind dual-writes to Postgres + Qdrant
3. Teamind pushes notification to all other connected sessions via channel:
   ```xml
   <channel source="teamind" type="new_decision" author="dev_alice">
   Chose PostgreSQL over MongoDB for user data — need ACID for payment transactions
   </channel>
   ```
4. Dev B's agent sees this in context without calling `teamind_search`

**Limitations:**
- Channel events are NOT buffered — only delivered to active sessions. **This is OK**: Teamind's pull-based tools (`teamind_context`, `teamind_search`) + startup sweep already ensure no decisions are missed. Channel push improves real-time awareness, not data completeness.
- Push is supplementary to pull-based capture layers, not a replacement
- Requires `--dangerously-load-development-channels` during research preview (custom dev channels avoid bug #36800 that affects official plugins)
- Requires claude.ai login (API keys not supported for channels)
- `teamind init` auto-allows Teamind tools in `permissions.allow` to prevent permission prompts from blocking agent

**Startup sweep:** On every `teamind serve` launch, BEFORE entering MCP event loop:
1. Scan `~/.claude/projects/` for JSONL files modified since last processed timestamp
2. Extract decisions from unprocessed content
3. Store to Postgres + Qdrant
4. This catches sessions that happened without Teamind running

### System Diagram

```
┌──────────────────────────────────────────────────────┐
│              IDE / Agent                              │
│     (Claude Code, Codex — MVP)                       │
│     (Cursor — Phase 2)                               │
│                                                       │
│  CLAUDE.md / AGENTS.md                               │
│  "Store decisions via teamind tools"                 │
│  "Include type, summary, affects when storing"       │
└──────────┬──────────────────────┬────────────────────┘
           │ MCP (stdio)          │ MCP (stdio)
      write/store             read/search
           │                      │
┌──────────▼──────────────────────▼────────────────────┐
│    Teamind HYBRID MCP+Channel Server (`teamind serve`)    │
│    Per-session, started by IDE, dies with session     │
│    capabilities: { tools: {}, experimental: { 'claude/channel': {} } }  │
│                                                       │
│  ┌──────────┐  ┌─────────────────────────────────┐   │
│  │ 3 MCP    │  │ JSONL File Watcher (PRIMARY)     │   │
│  │ Tools    │  │                                  │   │
│  │ (pull)   │  │ • Watches ~/.claude/projects/    │   │
│  │ store ──►│  │ • Tracks byte offset per file    │   │
│  │ search   │  │ • Parses new lines on change     │   │
│  │ context  │  │ • Stores raw text (no LLM)       │   │
│  └────┬─────┘  └──────────────┬──────────────────┘   │
│       │                       │                      │
│  ┌────┤  Channel Push (real-time)                    │
│  │    │  • New decisions from team → push to session │
│  │    │  • Contradiction alerts                      │
│  │    │  • via notifications/claude/channel           │
│       │                       │                      │
│  ┌────┤  ┌────────────────────┤                      │
│  │    │  │ Stop Hook Handler  │                      │
│  │    │  │ (HTTP localhost)   │                      │
│  │    │  │ • Fires on session │                      │
│  │    │  │   end (~60-70%)    │                      │
│  │    │  │ • Batch extraction │                      │
│  │    │  └────────────────────┘                      │
│  │    │                                              │
│  │  ┌─▼─────────────────────────────────────────┐   │
│  │  │ Dual Write                                 │   │
│  │  │ • INSERT to Supabase Postgres              │   │
│  │  │ • UPSERT to Qdrant Cloud                   │   │
│  │  │ • Dedup: content hash + session_id         │   │
│  │  └────────────────────────────────────────────┘   │
│  │                                                   │
│  │  ┌────────────────────────────────────────────┐   │
│  │  │ Offline Queue (~/.teamind/pending.jsonl)    │   │
│  │  │ Stores locally if cloud unreachable         │   │
│  │  │ Flushes on next successful API call         │   │
│  │  └─────────────────────┬──────────────────────┘   │
│  │                        │                          │
│  │  ┌─────────────────────┤                          │
│  │  │ Startup Sweep       │                          │
│  │  │ • On process start  │                          │
│  │  │ • Scan for missed   │                          │
│  │  │   transcripts       │                          │
│  │  │ • Extract + store   │                          │
│  │  └─────────────────────┘                          │
└──────────────────────┬───────────────────────────────┘
                       │ HTTPS
         ┌─────────────┴──────────────┐
         │                            │
┌────────▼─────────┐  ┌──────────────▼──────────────┐
│ Supabase         │  │ Qdrant Cloud                 │
│                  │  │                              │
│ Postgres         │  │ Single "decisions"           │
│ • orgs           │  │ collection                   │
│ • members        │  │ • org_id payload filter      │
│ • decisions      │  │ • server-side embeddings     │
│   (source of     │  │   (FastEmbed MiniLM 384d)    │
│    truth)        │  │ • hybrid search              │
│ • rate_limits    │  │   (dense + BM25 sparse)      │
│                  │  │                              │
│ Edge Functions   │  │                              │
│ • create org     │  │                              │
│ • join org       │  │                              │
│ • rotate key     │  │                              │
└──────────────────┘  └──────────────────────────────┘
```

### Key Architectural Decisions

| Decision | Why | Alternative rejected |
|----------|-----|---------------------|
| Channel-driven capture (not raw transcript parsing) | Agent has full session context — produces high-quality classified decisions. Zero LLM cost. No keyword heuristic noise. | Raw JSONL parsing (84% noise, no classification, brittle heuristics) |
| JSONL watcher as trigger, not parser | Watcher detects activity → triggers channel reminder → agent does the extraction. Watcher never parses content, only monitors for changes. | Watcher parses + extracts (fragile, format-dependent, noisy) |
| CLAUDE.md keyword triggers for read path | User says "знайди"/"пошукай"/"remember" → agent auto-calls teamind_search. Boosts retrieval rate from ~20% to ~50%+. | Rely on agent initiative (inconsistent, ~20% compliance) |
| Startup sweep on every `teamind serve` | Catches sessions that happened without Teamind. Processes unread transcript content. | No sweep (data gaps between sessions) |
| Agent-driven classification (no Haiku) | Zero LLM cost, zero model dependency, zero API key requirement. Agent has full session context — higher quality than post-hoc extraction. | Haiku enrichment (adds cost, API key dependency, complexity) |
| Dual storage: Postgres + Qdrant | Postgres = source of truth (ACID, PITR, SQL analytics). Qdrant = search layer (hybrid search). Industry standard pattern. | Qdrant-only (no ACID, weaker backup, no SQL for analytics) |
| Supabase (Postgres + Edge Functions) | Existing pro subscription, managed Postgres, zero ops, mature ecosystem. | Cloudflare all-in-one (D1 immature, full vendor lock-in) |
| Qdrant Cloud for vectors (not pgvector) | Hybrid search (dense + BM25) out of the box. Search quality is core product value. | pgvector (simpler migration, but no built-in hybrid search, worse quality at scale) |
| Single Qdrant collection + org_id filter | Qdrant docs: "collection-per-user is antipattern." Max 1000 collections. | Collection-per-org |
| Minimal Edge Functions (2-3 only) | CLI talks to Supabase directly via supabase-js for most operations. Edge Functions only for server logic (create org, join, rotate key). | Full API layer in Edge Functions (unnecessary abstraction for MVP) |
| `npm install -g` (not npx) | npx cold start = 3-10s blocking. Global = ~200ms. | npx (slow, registry dependency) |
| Zero native deps (no better-sqlite3) | Cloud storage = no local SQLite needed. 100% install success. | SQLite local (15-25% install failures) |
| Apache 2.0 license (not BSL) | Developer community trust. Monetize cloud, not license. | BSL 1.1 (scares contributors, friction with early adopters) |
| Hybrid MCP+Channel server | Real-time push of team decisions to active sessions. No competitor has this. ~5 lines to enable, massive UX improvement. | Pull-only (agent must explicitly call teamind_search to see new decisions) |

### MCP Tools (3 tools) + Channel Push

#### teamind_store

```
Store a team decision, architectural constraint, coding pattern, or lesson learned
into the shared team brain. Call this when:
- A technical decision is made ("We chose PostgreSQL because...")
- A constraint is identified ("Client requires Safari 15+ support")
- A pattern is established ("All API endpoints use /api/v1/{resource}")
- A lesson is learned from a bug or incident

Do NOT store: status updates, trivial changes, questions without answers,
brainstorming without conclusions.

Include type, summary, and affects when possible — this makes decisions
more searchable and useful for the whole team.

Input: {
  text: string,                                              // required, min 10 chars
  type?: 'decision' | 'constraint' | 'pattern' | 'lesson',  // optional, agent classifies
  summary?: string,                                          // optional, max 100 chars
  affects?: string[]                                         // optional, e.g. ["auth", "payments"]
}
Returns: {id, status: "stored"} immediately.
```

| Step | Where | Latency | Agent waits? |
|------|-------|---------|-------------|
| Validate input (min 10 chars, secret detection) | MCP server | <5ms | Yes |
| Dual write: INSERT Postgres + UPSERT Qdrant | Supabase + Qdrant Cloud | ~100-200ms | Yes |
| Return {id, status: "stored"} to agent | MCP server | — | Done |

No async enrichment. What the agent sends is what gets stored. Auto-captured text from file watcher/stop hook is stored as-is with `type: 'pending'`.

#### teamind_search

```
Search the team's shared decision history before making architectural choices.
Call this BEFORE:
- Choosing a technology, library, or pattern (check if the team already decided)
- Modifying a module's architecture (check for existing constraints)
- Implementing something you're unsure about (check for lessons learned)

Input: {query: string, type?: string, limit?: number}
Returns: [{decision, score, type, summary, affects}] ranked by relevance.
```

Qdrant hybrid search: dense vectors (MiniLM 384d) + sparse BM25 + payload filter (org_id). No manual keyword extraction needed — Qdrant generates both dense and sparse vectors server-side from raw text.

#### teamind_context

```
Load relevant team decisions for the current task. Call this at the START of
a new task or when switching context to a different part of the codebase.

Input: {task_description: string, files?: string[]}
Returns: [{relevant_decisions}] + summary of key constraints.
```

Piggyback: if this is the FIRST tool call in a session, include a brief note: "N total decisions in team brain. Use teamind_search for specific queries."

#### Channel Push Events

Teamind pushes events to all connected team sessions when:

| Event | Trigger | Channel Content |
|-------|---------|----------------|
| New decision | Any `teamind_store` (explicit or auto-capture) | `<channel source="teamind" event="new_decision" author="dev_name" type="decision">summary text</channel>` |
| Contradiction detected | Store matches existing decision with conflicting content (Phase 2) | `<channel source="teamind" event="contradiction" decision_id="...">Decision X contradicts Y</channel>` |

Push flow:
1. `teamind_store` succeeds (dual write complete)
2. Server calls Supabase to get list of connected sessions for this org (via presence tracking or polling)
3. Emits `notifications/claude/channel` with decision summary
4. Receiving sessions see the event as a `<channel>` tag in context

**Note:** Channel push requires Claude Code v2.1.80+ and `--channels` flag. Sessions without channel support still work normally via pull-based tools.

### Decision Object Schema

```typescript
interface Decision {
  id: string

  // Core
  type: 'decision' | 'constraint' | 'pattern' | 'lesson' | 'pending'
  summary: string | null      // max 100 chars, null if auto-captured
  detail: string              // full text
  status: 'active' | 'deprecated' | 'superseded' | 'proposed'

  // Metadata
  author: string              // dev name or "agent"
  source: 'mcp_store' | 'file_watcher' | 'stop_hook' | 'seed'
  project_id: string
  org_id: string
  session_id: string | null   // for dedup across capture layers
  created_at: string          // ISO 8601
  updated_at: string
  confidence: number | null   // 1-10, set by agent if provided

  // Classification (set by agent at store time, or null for auto-captured)
  affects: string[]           // ["auth-service", "payment-api"]

  // Relationships (Phase 2)
  depends_on: string[]
  contradicts: string[]
  replaces: string[]
  decided_by: string[]
}
```

### Secret Detection (before storage)

Block entire record if any pattern matches (don't redact, don't store):

```
AWS Access Key:       AKIA[0-9A-Z]{16}
Anthropic API Key:    sk-ant-[a-zA-Z0-9_-]{80,}
OpenAI API Key:       sk-[a-zA-Z0-9]{20,}T3BlbkFJ | sk-proj-[a-zA-Z0-9_-]{80,}
GitHub Token:         ghp_[A-Za-z0-9]{36} | github_pat_ | gho_
Private Key:          -----BEGIN (RSA |EC )?PRIVATE KEY-----
JWT:                  eyJ[A-Za-z0-9_-]{10,}\.eyJ
Database URL:         (postgres|mysql|mongodb|redis)://[^\s]+@
Slack Token:          xox[bpras]-[0-9]{10,}
Stripe Key:           (sk|pk)_(test|live)_[A-Za-z0-9]{24,}
Generic Secret:       (password|secret|token|api_key)\s*[:=]\s*['"][^\s]{8,}
```

Agent receives: `{error: "secret_detected", pattern: "Anthropic API Key", action: "blocked"}`

### Offline Mode

| Tool | Offline behavior |
|------|-----------------|
| teamind_store | Queue to `~/.teamind/pending.jsonl`. Return `{stored: true, synced: false}`. Flush on reconnect. |
| teamind_search | Return `{results: [], offline: true, note: "Cloud unavailable. Search offline."}`. Agent proceeds without context. |
| teamind_context | Same as search — empty results, no crash. |

---

## 3. Backend

### Data Flow

**Explicit store (MCP tool):**
1. Agent calls `teamind_store({text, type?, summary?, affects?})`
2. MCP server validates + secret check
3. Dual write: INSERT to Postgres (source of truth) + UPSERT to Qdrant (search)
4. Return `{id, status: "stored"}`

**Auto-capture (file watcher / stop hook):**
1. Watcher detects new JSONL content or stop hook fires
2. Parse transcript, extract decision-worthy text
3. Dual write with `type: 'pending'`, `source: 'file_watcher' | 'stop_hook'`
4. Dedup by content hash + session_id

**Search:**
1. Agent calls `teamind_search({query, type?, limit?})`
2. MCP server calls Qdrant Cloud directly (hybrid search with org_id filter)
3. Returns ranked results

### Supabase Postgres Schema

```sql
-- Organizations
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  decision_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Members
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
  api_key TEXT UNIQUE NOT NULL,          -- per-member key
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

-- Decisions (source of truth — text lives here)
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  type TEXT NOT NULL DEFAULT 'pending',  -- decision/constraint/pattern/lesson/pending
  summary TEXT,                           -- max 100 chars, null if auto-captured
  detail TEXT NOT NULL,                   -- full text
  status TEXT NOT NULL DEFAULT 'active',  -- active/deprecated/superseded/proposed
  author TEXT NOT NULL,
  source TEXT NOT NULL,                   -- mcp_store/file_watcher/stop_hook/seed
  project_id TEXT,
  session_id TEXT,                        -- for dedup
  confidence INT,
  affects TEXT[] DEFAULT '{}',
  content_hash TEXT NOT NULL,             -- for dedup
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_decisions_org_id ON decisions(org_id);
CREATE INDEX idx_decisions_type ON decisions(org_id, type);
CREATE INDEX idx_decisions_content_hash ON decisions(content_hash);
CREATE INDEX idx_decisions_session_id ON decisions(session_id);

-- Rate limits
CREATE TABLE rate_limits (
  org_id UUID NOT NULL REFERENCES orgs(id),
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  store_count INT NOT NULL DEFAULT 0,
  search_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day)
);
```

### Supabase Edge Functions (minimal)

Only 3 functions — server-side logic that can't run in CLI:

| Function | Purpose | Why Edge Function? |
|----------|---------|--------------------|
| `create-org` | Generate org + API key + invite code | Crypto key generation, ensure uniqueness |
| `join-org` | Validate invite code, add member | Atomic: check invite + check limit + insert member |
| `rotate-key` | Generate new API key, invalidate old | Security: must be server-side |

Everything else (store decision, search, dashboard, export) — CLI talks directly to Supabase via `supabase-js` and to Qdrant via REST API.

### Qdrant Cloud

- Single `decisions` collection
- Server-side embeddings: FastEmbed MiniLM-L6-v2 (384d)
- Hybrid search: dense vectors + BM25 sparse, fused ranking
- Payload: full decision object (text + metadata) for search result display
- `org_id` indexed payload field for tenant isolation
- Free tier: 1GB RAM, 4GB disk, 5M embedding tokens/month

### Tenant Isolation

- Qdrant: single collection, all queries filter by `org_id` — enforced in MCP server code
- Postgres: Row Level Security on `decisions` table by `org_id`
- API key maps to org_id — validated on every request
- Encryption at rest (Supabase + Qdrant Cloud defaults) + in transit (TLS 1.3)

---

## 4. Setup Flow

### New org creator:

```bash
$ npm install -g teamind               # Pure JS, ~5-10 seconds, 100% success

$ teamind init

  Welcome to Teamind — shared brain for your AI team.

  [1] Create new organization
  [2] Join existing organization (invite code)
  > 1

  Organization name: acme-eng
  ✅ Created org "acme-eng"
  📋 Invite code: ACME-7X3K (share with your team)

  Detected IDEs: Claude Code, Codex

  Seeding knowledge base...
  → Parsed CLAUDE.md: 12 decisions
  → Parsed AGENTS.md: 4 patterns
  → Scanned git log: 5 decisions
  ✅ Seeded 21 decisions

  Configuring IDEs...
  ✅ Added MCP server to Claude Code
  ✅ Added MCP server to Codex
  ✅ Added instructions to CLAUDE.md (<!-- teamind:start/end -->)

  Verification...
  ✅ Stored test decision → found via search
  ✅ Teamind is working!

  Next: share invite code ACME-7X3K with your team
  Run `teamind status` anytime | `teamind dashboard` for overview
```

### Team member joining:

```bash
$ npm install -g teamind
$ teamind init --join ACME-7X3K

  ✅ Joined org "acme-eng" (47 decisions already available)
  ... (same IDE config)
```

### CLAUDE.md / AGENTS.md handling:

- No config file exists → create project-level file with teamind block
- File exists in project → append teamind block between markers (`<!-- teamind:start -->` / `<!-- teamind:end -->`)
- File exists in parent only → create NEW project-level, never modify parent
- Markers already exist → replace content between markers (idempotent)

### What the injected instructions tell agents:

```markdown
<!-- teamind:start -->
## Team Knowledge (Teamind)

### Auto-search triggers
Call `teamind_search` automatically when the user mentions:
- "знайди", "пошукай", "згадай", "нагадай", "як ми вирішили", "що ми робили з"
- "remember", "recall", "find", "what did we decide", "how did we handle"
- Any question about architecture, conventions, past decisions, or existing patterns

### Auto-store triggers
Call `teamind_store` when:
- A technical choice is made between alternatives
- The user says "запам'ятай", "збережи", "remember this", "store this"
- A constraint is identified (client/regulatory/infra)
- A coding pattern or convention is established
- A lesson is learned from a bug or incident

When storing, always include: `type` (decision/constraint/pattern/lesson), `summary` (max 100 chars), `affects` (list of modules).

### Context loading
Call `teamind_context` at the start of every new task or when switching to a different part of the codebase.

### Channel reminders
When you receive a `<channel source="teamind" event="capture_reminder">`, review your recent work and store any decisions made via `teamind_store`.
<!-- teamind:end -->
```

---

## 5. MVP Scope (2-3 weeks with AI agents)

### IN

| Component | Details |
|-----------|---------|
| **CLI** | init, init --join, serve, status, dashboard, export, uninstall, config set/get |
| **Hybrid MCP+Channel Server** | 3 tools (store, search, context) + channel push (capture reminders + team broadcast). stdio transport. |
| **JSONL Activity Watcher** | Monitors `~/.claude/projects/` for activity → triggers channel capture reminder. Not a parser — only detects changes. |
| **Stop Hook Handler** | HTTP handler on localhost. Fires channel capture reminder on session end. |
| **Startup Sweep** | On every serve launch, push channel reminder for any unprocessed sessions |
| **Supabase Postgres** | Orgs, members, decisions (source of truth), rate limits |
| **Qdrant Cloud** | Single collection, server-side MiniLM embeddings, hybrid search |
| **Supabase Edge Functions** | 3 functions (create org, join org, rotate key) |
| **Dual write** | Every decision → Postgres INSERT + Qdrant UPSERT |
| **Seed-on-init** | CLAUDE.md + AGENTS.md + git log parsing |
| **IDE auto-setup** | Claude Code + Codex MCP configs (Cursor Phase 2) |
| **CLAUDE.md / AGENTS.md injection** | Delimited markers, safe creation/update/removal |
| **Offline queue** | `~/.teamind/pending.jsonl`, flush on reconnect |
| **Secret detection** | 10 regex patterns, block don't redact |
| **teamind status** | Health check (cloud, Qdrant, decision count, pending queue) |
| **teamind dashboard** | CLI report from Postgres (counts, recent, by author) |
| **teamind export** | JSON + Markdown export from Postgres |
| **teamind uninstall** | Clean removal via manifest.json |
| **Error handling** | Defined messages for all failure modes |

### NOT IN (by phase)

| Phase 2 | Phase 3 | Phase 3+ |
|---|---|---|
| Web dashboard (Vercel, read-only) | Knowledge graph visualization | Knowledge Marketplace (curated KB as MCP products) |
| Cursor support (.cursorrules + SQLite watcher) | Meeting transcript capture | Cross-org anonymized benchmarks |
| Slack integration | PRD generation from knowledge | AI moderator (decision quality review) |
| GitHub PR mining | Onboarding doc generator | Custom embedding models (BYOM) |
| Contradiction detection | SSO (SAML/OIDC) | On-premise deployment |
| RBAC (roles beyond API keys) | SOC 2 Type II | Webhooks for all events |
| LLM enrichment (model-agnostic: Haiku/GPT-4o-mini/Ollama) | Data residency (EU/US) | |
| Analytics (velocity, coverage) | Decision templates per industry | |
| MCP directory listings (PulseMCP, Smithery, mcp.so) | | |

---

## 6. Pricing

| Plan | Price | Includes |
|------|-------|----------|
| **Free** | $0 | Cloud storage, 500 decisions, 5 devs, 100 searches/day, no expiry |
| **Team** | $25/mo base + usage | 5,000 decisions, 50 devs, 1-year retention, web dashboard, RBAC |
| **Business** | $99/mo base + usage | Unlimited, SSO, audit logs, compliance reports, API |
| **Enterprise** | Custom | Data residency, SLAs, on-prem, custom integrations |

Usage overage: $0.005/decision, $0.002/search beyond plan limits.
Enforced server-side via Postgres counters (rate_limits table).

---

## 7. Security

- **Dual storage**: Postgres (ACID, PITR backups) = source of truth. Qdrant = search layer. Data survives either failing.
- **Tenant isolation**: Qdrant org_id payload filter + Postgres RLS. Enforced at MCP server + DB level.
- **No LLM API key required**: MVP has zero dependency on external AI services for end users
- **Encryption**: at rest (Supabase + Qdrant Cloud defaults) + in transit (TLS 1.3)
- **Secret detection**: 10 regex patterns, block entire record if matched
- **Org API keys**: generated on create, rotatable via `teamind config rotate-key` (Edge Function)
- **Local config**: `~/.teamind/config.json` with 0600 permissions
- Phase 2: access logs, RBAC
- Phase 3: SSO, SOC 2, data residency

---

## 8. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| CLI + MCP Server | **Node.js + TypeScript** | MCP SDK is TS. Pure JS, zero native deps. |
| Database | **Supabase Postgres** | Existing pro subscription, managed, ACID, PITR, RLS, zero ops |
| Server logic | **Supabase Edge Functions** (Deno) | Only 3 functions needed, same platform as DB |
| Vector storage | **Qdrant Cloud** | Server-side embeddings, hybrid search (dense + BM25), search quality is core product value |
| Embedding model | **MiniLM-L6-v2 (384d)** | Via Qdrant Cloud Inference. 5M free tokens/mo. |
| Sparse search | **BM25 via Qdrant** | Unlimited free. Hybrid with dense. |
| License | **Apache 2.0** | Developer trust. Monetize cloud, not license. |

### Repo Structure

```
teamind/
├── packages/
│   └── cli/                 # CLI + MCP server + capture + all logic
├── supabase/
│   ├── migrations/          # Postgres schema
│   └── functions/           # Edge Functions (create-org, join-org, rotate-key)
├── LICENSE                  # Apache 2.0
├── AGENTS.md                # Teamind eats its own dogfood
├── package.json             # pnpm workspace
└── README.md
```

### Infrastructure Cost (MVP)

| Component | Service | Cost |
|-----------|---------|------|
| Postgres + Edge Functions | Supabase Pro | $0 (existing subscription) |
| Vector search + embeddings | Qdrant Cloud free tier | $0 |
| **Total** | | **$0/month additional** |

---

## 9. Competitive Positioning

| | memctl | Grov | ByteRover | **Teamind** |
|---|---|---|---|---|
| Architecture | Pure MCP | Proxy + MCP | MCP daemon | **Pure MCP + Cloud** |
| Storage | Turso cloud | Supabase | Local markdown | **Postgres + Qdrant (dual)** |
| Search | FTS5 + vector | OpenAI embeddings | Markdown search | **Hybrid (dense+BM25)** |
| Decision typing | flat text | flat text | flat text | **Typed (agent-classified)** |
| LLM dependency | None | OpenAI required | None | **None (MVP)** |
| Seed-on-init | No | No | No | **Yes — Day 1 value** |
| Native deps | better-sqlite3 | better-sqlite3 | Go binary | **Zero (pure JS)** |
| Offline support | Cloud-dependent | Proxy-dependent | Local-first | **Queue + degrade** |
| Secret detection | No | No | No | **Yes — block before store** |
| Data safety | Single store | Single store | Local files | **Dual store (Postgres + Qdrant)** |
| License | Apache 2.0 | Apache 2.0 | Freemium | **Apache 2.0** |

---

## 10. Go-To-Market

### Launch sequence

| Day | Action |
|-----|--------|
| 1-2 | Scaffold + Supabase schema + Qdrant setup + Edge Functions |
| 3-5 | Hybrid MCP+Channel server (store, search, context + capture reminders + broadcast) |
| 6-8 | CLI (init, serve, status, search, uninstall) + activity watcher + stop hook |
| 9-10 | Seed-on-init + IDE auto-setup + CLAUDE.md/AGENTS.md injection with keyword triggers |
| 11-12 | Secret detection + offline queue + error messages + polish |
| 13-14 | Dogfood on own team |
| Week 3 | Install for 3-5 consulting clients + iterate |
| Week 4 | Show HN + Product Hunt + LinkedIn |
| Week 5+ | Phase 2 (dashboard, export, Cursor, Slack, GitHub) |

### Content hooks

- "Your AI team makes 47 decisions/week. You see zero of them."
- "I gave my AI agents a shared brain. They stopped contradicting each other."
- "75% of AI agents break working code. Here's what I built."

### Distribution

LinkedIn (existing audience) → Show HN → Product Hunt → GitHub → MCP directories → r/ClaudeCode, r/cursor

---

## 11. Known Risks (Accepted)

| Risk | Severity | Mitigation |
|------|----------|------------|
| CLAUDE.md compliance 10-20% | HIGH | **RESOLVED by file watcher (~100% capture) + stop hook (~60-70%) + startup sweep.** MCP store = bonus, not primary. |
| No auto-context in MCP protocol | HIGH | Seed critical decisions into CLAUDE.md. Instruction to call teamind_context. Piggyback on first tool call. |
| Platform risk (Copilot Memory org scope) | HIGH | Ship fast. Differentiate on typed decisions + auto-capture + dual storage. |
| Market timing (6-12 month window) | HIGH | MVP in 6-8 weeks. Install for consulting clients first. |
| JSONL transcript format instability | HIGH | Version-aware parser. Graceful degradation on unknown format. |
| Claude Code deletes transcripts after 30 days | MEDIUM | Startup sweep processes files immediately. Set cleanupPeriodDays during init. |
| Qdrant Cloud dependency | MEDIUM | Text in Postgres. Qdrant = search layer only. Can swap to pgvector if needed. |
| File watcher edge cases (WSL2, partial reads) | MEDIUM | Byte offset tracking. Polling fallback for WSL2. node-tail buffer pattern. |
| Agent classification quality varies | MEDIUM | Hybrid search works on raw text regardless. Classification is enhancement, not requirement. |
| Supabase Edge Function cold start (~200ms) | LOW | Only 3 functions, called rarely (init, join, rotate). Not in hot path. |
| Free tier abuse | LOW | Server-side limits via Postgres rate_limits table. |

---

## 12. Acceptance Criteria

1. `npm install -g teamind` succeeds on macOS (ARM64 + Intel), Linux (x64), Windows — zero native compilation
2. `teamind init` creates org + seeds + configures IDEs in <3 minutes
3. Dev A stores decision on Machine A → Dev B on Machine B finds it via `teamind_search`
4. Seed-on-init extracts 15+ decisions from CLAUDE.md + AGENTS.md + git log
5. `teamind_store` with structured input (type, summary, affects) stores correctly in both Postgres and Qdrant
6. `teamind search "authentication"` finds a decision about JWT (via Qdrant hybrid search)
7. `teamind dashboard` shows team activity from Postgres (counts, recent, by author)
8. `teamind export --json` produces valid, complete export of all org decisions
9. `teamind uninstall` removes all configs cleanly, mentions cloud data persistence
10. Offline: `teamind_store` queues locally, `teamind_search` returns empty gracefully
11. Secret detection blocks storage of known key patterns (Anthropic, AWS, GitHub, etc.)
12. Auto-captured raw text (from file watcher) is findable via hybrid search
13. 3 private beta teams use it for 1 week without critical bugs

---

## 13. Error Messages

```
# Cloud unreachable
Warning: Teamind Cloud unreachable.
Decisions queued locally (3 pending). Search unavailable offline.
Will sync automatically when connected.

# Org not found
Error: Organization not found.
Run: teamind init (create new) or teamind init --join CODE (join existing)

# Invite code invalid
Error: Invite code ACME-7X3K is invalid or expired.
Ask your team lead: teamind org invite (generates new code)

# Free tier limit
Warning: Free tier limit reached (500/500 decisions).
New decisions will not be stored. Options:
  teamind billing upgrade
  teamind decisions prune --older-than 30d

# Secret detected
Blocked: Secret detected (Anthropic API Key) in input.
Decision NOT stored. Remove the secret and try again.

# Qdrant unreachable
Warning: Qdrant Cloud unreachable. Search unavailable.
Decisions saved to Postgres. Search will resume when Qdrant is back.

# Dual write partial failure
Warning: Saved to Postgres but Qdrant write failed.
Decision is safe. Search index will sync on next successful connection.
```
