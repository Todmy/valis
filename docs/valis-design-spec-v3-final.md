# Valis — Design Specification v4 (Final)

**Date:** 2026-03-17
**Status:** Final — approved after 4 iterations of review + external analysis
**Identity:** Team Brain from Day 1
**License:** Apache 2.0 (monetize cloud, not license)

---

## 1. Product Overview

**Valis** — shared decision intelligence for AI-augmented engineering teams.

**One-liner:** Your team's AI agents share one brain. Decisions made in one session are available in every session, for every developer.

**Problem:** AI team of 5 devs generates decisions at a pace no engineering manager can track. Who decided what? Does it contradict yesterday? What's the full picture?

**Target:** Engineering Manager / Tech Lead / CTO. Teams 15-50 devs, 50%+ using AI agents daily.

**Differentiator vs memctl:** memctl = flat text memory. Valis = typed decision objects (decision/constraint/pattern/lesson) with Haiku classification, Qdrant hybrid search (dense + BM25), and team-wide shared context.

---

## 2. Architecture

### Core Principles

1. **Cloud-first** — team sync, org management, shared storage from Day 1
2. **Minimally invasive** — pure MCP, no proxy, no stream interception
3. **Non-blocking** — if Valis fails, IDE works normally
4. **API key stays local** — user's Anthropic key never leaves their machine
5. **Zero native dependencies** — pure JS/TS npm package, no compilation
6. **Auto-capture by default** — three capture layers in one process, user does nothing

### Capture Architecture: Three Layers, One Process

Every `valis serve` process runs ALL three capture mechanisms simultaneously:

| Layer | Mechanism | Coverage | Quality |
|-------|-----------|----------|---------|
| **1. JSONL File Watcher** (primary) | Watches `~/.claude/projects/` for transcript changes, extracts decisions from new lines | ~100% (Claude Code), ~0% (Cursor/Codex) | Medium (auto-extracted, needs Haiku) |
| **2. Stop Hook** (secondary) | HTTP handler on localhost, Claude Code fires on session end, batch-extracts from transcript | ~60-70% (misses /exit, stalls, long sessions) | High (full session context) |
| **3. MCP valis_store** (explicit) | Agent calls tool when instructed via CLAUDE.md | ~10-20% (compliance varies) | Highest (agent curated) |

Overlap between layers → dedup by content hash + session_id.

**Startup sweep:** On every `valis serve` launch, BEFORE entering MCP event loop:
1. Scan `~/.claude/projects/` for JSONL files modified since last processed timestamp
2. Extract decisions from unprocessed content
3. Store to cloud
4. This catches sessions that happened without Valis running

### System Diagram

```
┌──────────────────────────────────────────────────────┐
│              IDE / Agent                              │
│     (Claude Code, Cursor, Codex)                     │
│                                                       │
│  CLAUDE.md / AGENTS.md / .cursorrules                │
│  "Store decisions via valis tools"                 │
└──────────┬──────────────────────┬────────────────────┘
           │ MCP (stdio)          │ MCP (stdio)
      write/store             read/search
           │                      │
┌──────────▼──────────────────────▼────────────────────┐
│    Valis MCP Server — SINGLE PROCESS (`valis serve`)  │
│    Per-session, started by IDE, dies with session     │
│                                                       │
│  ┌──────────┐  ┌─────────────────────────────────┐   │
│  │ 3 MCP    │  │ JSONL File Watcher (PRIMARY)     │   │
│  │ Tools    │  │                                  │   │
│  │          │  │ • Watches ~/.claude/projects/    │   │
│  │ store ──►│  │ • Tracks byte offset per file    │   │
│  │ search   │  │ • Parses new lines on change     │   │
│  │ context  │  │ • Extracts decisions via Haiku    │   │
│  └────┬─────┘  └──────────────┬──────────────────┘   │
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
│  │  │ Local Enrichment (async, same process)     │   │
│  │  │ • Haiku classify: type/summary/affects       │   │
│  │  │ • PATCH enriched record to cloud            │   │
│  │  │ • Dedup: content hash + session_id          │   │
│  │  └────────────────────────────────────────────┘   │
│  │                                                   │
│  │  ┌────────────────────────────────────────────┐   │
│  │  │ Offline Queue (~/.valis/pending.jsonl)    │   │
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
┌──────────────────────▼───────────────────────────────┐
│              Valis Cloud                            │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │  Cloudflare Workers (Hono)                    │    │
│  │  8 API endpoints + cron + queue               │    │
│  └──────┬──────────────────────┬────────────────┘    │
│         │                      │                     │
│  ┌──────▼──────┐  ┌───────────▼─────────────┐       │
│  │ Cloudflare   │  │ Qdrant Cloud             │       │
│  │ D1 (SQLite)  │  │                          │       │
│  │              │  │ Single "decisions"        │       │
│  │ • orgs       │  │ collection               │       │
│  │ • members    │  │ • org_id payload filter   │       │
│  │ • invite     │  │ • server-side embeddings  │       │
│  │   codes      │  │   (FastEmbed MiniLM 384d) │       │
│  │ • rate       │  │ • hybrid search           │       │
│  │   limits     │  │   (dense + BM25 sparse)   │       │
│  └──────────────┘  └───────────────────────────┘       │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │ Cloudflare Cron Trigger (every 5 min)         │    │
│  │ Re-enriches orphaned pending records          │    │
│  │ using Valis's own Haiku key                 │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │ Cloudflare Queue (for seed batch)             │    │
│  │ Processes bulk seed enrichment async          │    │
│  └──────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────┘
```

### Key Architectural Decisions (validated through 4 iterations + external analysis)

| Decision | Why | Alternative rejected |
|----------|-----|---------------------|
| Three capture layers in ONE process | File watcher (~100%) + Stop hook (~60-70%) + MCP store (~10-20%). No separate daemon. | Separate daemon (lifecycle management), MCP-only (10-20% capture) |
| JSONL file watcher = primary capture | Append-only files always exist, survive crashes, ~100% coverage. Agent compliance is 10-20% without it. | MCP-only relying on CLAUDE.md instructions |
| Startup sweep on every `valis serve` | Catches sessions that happened without Valis. Processes unread transcript content. | No sweep (data gaps between sessions) |
| Single Qdrant collection + org_id filter | Qdrant docs: "collection-per-user is antipattern." Max 1000 collections. | Collection-per-org |
| Haiku enrichment runs LOCAL (MCP server) | API key never leaves user's machine. Security. | Cloud Worker enrichment (key custody risk) |
| Cloudflare Cron for orphaned records | Retries enrichment that failed when session died. Uses Valis's key (~$0.001/orphan). | "Retry on next session start" (unreliable) |
| Cloudflare Queue for seed batch | Seed-on-init = 15-30 records. Sequential Haiku = 75s. Queue = async, init returns in <5s. | Sequential enrichment in Worker waitUntil |
| `npm install -g` (not npx) | npx cold start = 3-10s blocking. Global = ~200ms. | npx (slow, registry dependency) |
| Zero native deps (no better-sqlite3) | Cloud storage = no local SQLite needed. 100% install success. | SQLite local (15-25% install failures) |
| API key optional at init | Wider adoption funnel. Store raw, enrich later. | Mandatory key (blocks users without Anthropic account) |
| Apache 2.0 license (not BSL) | Developer community trust. Monetize cloud, not license. | BSL 1.1 (scares contributors, friction with early adopters) |

### MCP Tools (3 tools)

#### valis_store

```
Store a team decision, architectural constraint, coding pattern, or lesson learned
into the shared team brain. Call this when:
- A technical decision is made ("We chose PostgreSQL because...")
- A constraint is identified ("Client requires Safari 15+ support")
- A pattern is established ("All API endpoints use /api/v1/{resource}")
- A lesson is learned from a bug or incident

Do NOT store: status updates, trivial changes, questions without answers,
brainstorming without conclusions.

Input: {text: string} — raw text describing the decision/constraint/pattern/lesson.
Returns: {id, status: "stored"} immediately. Enrichment happens automatically.
```

| Step | Where | Latency | Agent waits? |
|------|-------|---------|-------------|
| Validate input (min 10 chars, secret detection) | MCP server | <5ms | Yes |
| Store raw text to Qdrant Cloud | Cloud API | ~50-100ms | Yes |
| Return {id, status: "stored"} to agent | MCP server | — | Done |
| Call Haiku for classification (type, summary, affects, confidence) | MCP server (async) | ~3s | No |
| PATCH enriched record to Qdrant Cloud | Cloud API | ~50ms | No |

If Haiku fails or session dies before enrichment: record stays as raw text with `extraction_status: 'pending'`. Cloudflare Cron re-enriches within 5 minutes.

#### valis_search

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

#### valis_context

```
Load relevant team decisions for the current task. Call this at the START of
a new task or when switching context to a different part of the codebase.

Input: {task_description: string, files?: string[]}
Returns: [{relevant_decisions}] + summary of key constraints.
```

Piggyback: if this is the FIRST tool call in a session, include a brief note: "N total decisions in team brain. Use valis_search for specific queries."

### Decision Object Schema

```typescript
interface Decision {
  id: string

  // Core
  type: 'decision' | 'constraint' | 'pattern' | 'lesson' | 'pending'
  summary: string           // max 100 chars
  detail: string            // full context
  status: 'active' | 'deprecated' | 'superseded' | 'proposed'

  // Metadata
  author: string            // dev name or "agent"
  source: 'agent_session' | 'seed' | 'manual'
  project_id: string
  org_id: string
  created_at: string        // ISO 8601
  updated_at: string
  confidence: number        // 1-10
  extraction_status: 'pending' | 'enriched' | 'failed'

  // Enriched by Haiku (async)
  affects: string[]         // ["auth-service", "payment-api"]
  // search_keywords removed — Qdrant BM25 + dense hybrid search replaces manual keyword extraction

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
| valis_store | Queue to `~/.valis/pending.jsonl`. Return `{stored: true, synced: false}`. Flush on reconnect. |
| valis_search | Return `{results: [], offline: true, note: "Cloud unavailable. Search offline."}`. Agent proceeds without context. |
| valis_context | Same as search — empty results, no crash. |

---

## 3. Cloud Backend

### API Endpoints

```
POST   /orgs                         # Create org → returns org_id + API key + invite code
POST   /orgs/:id/join                # Join with invite code → returns API key
GET    /orgs/:id/members             # List members
POST   /orgs/:id/decisions           # Store raw decision → Qdrant upsert
PATCH  /orgs/:id/decisions/:did      # Update enriched fields after Haiku
POST   /orgs/:id/decisions/search    # Hybrid search (dense + BM25 + org_id filter)
POST   /orgs/:id/decisions/batch     # Bulk store for seed-on-init → enqueue enrichment
GET    /orgs/:id/dashboard           # Aggregated stats (counts by type/author/date)
```

### Infrastructure

| Component | Service | Why | Cost (MVP) |
|-----------|---------|-----|------------|
| API Server | Cloudflare Workers (Hono) | Zero cold start, 100K req/day free | $0 |
| Org/member data | Cloudflare D1 | Relational, SQL, 5M reads/day free | $0 |
| Decision storage | Qdrant Cloud (free tier) | 1GB RAM, 4GB disk, server-side embeddings | $0 |
| Embeddings | Qdrant Cloud Inference (MiniLM 384d) | Server-side, 5M tokens/month free, BM25 unlimited | $0 |
| Seed enrichment | Cloudflare Queues | Async batch processing, 15 min per batch | $0 (first 1M ops) |
| Orphan retry | Cloudflare Cron Triggers | Every 5 min, re-enriches pending records | $0 |
| Rate limit counters | Cloudflare KV | ~5ms reads, approximate enforcement | $0 |
| **Total MVP infra** | | | **$0/month** |

### Tenant Isolation

- Single `decisions` collection in Qdrant with `org_id` indexed payload field
- All queries filter by `org_id` — enforced at API layer
- D1 stores org membership — API validates org_id matches API key
- Encryption at rest (Qdrant Cloud default) + in transit (TLS 1.3)

### Cron Trigger: Orphan Enrichment

Every 5 minutes:
1. Query Qdrant: `extraction_status = 'pending' AND updated_at < (now - 2 min)`
2. For each orphan: call Haiku (Valis's own key) for classification (type, summary, affects, confidence)
3. Update record in Qdrant
4. Cost: ~$0.001 per orphan. At 50 orphans/day = $0.05/day = $1.50/month

---

## 4. Setup Flow

### New org creator:

```bash
$ npm install -g valis               # Pure JS, ~5-10 seconds, 100% success

$ valis init

  Welcome to Valis — shared brain for your AI team.

  [1] Create new organization
  [2] Join existing organization (invite code)
  > 1

  Organization name: acme-eng
  ✅ Created org "acme-eng"
  📋 Invite code: ACME-7X3K (share with your team)

  Anthropic API key (for smarter decision enrichment):
  [Enter key or press Enter to skip]
  > sk-ant-...
  ✅ API key valid — decisions will be auto-classified

  Detected IDEs: Claude Code, Cursor

  Seeding knowledge base...
  → Parsed CLAUDE.md: 12 decisions
  → Parsed .cursorrules: 3 patterns
  → Scanned git log: 5 decisions
  ✅ Seeded 20 decisions (enrichment processing in background)

  Configuring IDEs...
  ✅ Added MCP server to Claude Code
  ✅ Added MCP server to Cursor
  ✅ Added instructions to CLAUDE.md (<!-- valis:start/end -->)

  Verification...
  ✅ Stored test decision → found via search
  ✅ Valis is working!

  Next: share invite code ACME-7X3K with your team
  Run `valis status` anytime | `valis dashboard` for overview
```

### Team member joining:

```bash
$ npm install -g valis
$ valis init --join ACME-7X3K

  ✅ Joined org "acme-eng" (20 decisions already available)
  ... (same IDE config + optional API key)
```

### CLAUDE.md handling:

- No CLAUDE.md exists → create project-level `CLAUDE.md` with valis block
- CLAUDE.md exists in project → append valis block between markers
- CLAUDE.md exists in parent only → create NEW project-level, never modify parent
- Markers already exist → replace content between markers (idempotent)

### API key handling:

- Provided → stored in `~/.valis/config.json` (0600 permissions). Local enrichment active.
- Skipped → decisions stored as raw text. Search works on raw text only. User can add later: `valis config set api-key sk-ant-...`
- Never sent to cloud. Ever.

---

## 5. MVP Scope (8-10 weeks)

### IN

| Component | Details |
|-----------|---------|
| **CLI** | init, init --join, serve, status, dashboard, export, uninstall, config set/get |
| **MCP Server** | 3 tools (store, search, context), stdio transport, file watcher, stop hook handler |
| **JSONL File Watcher** | Primary auto-capture from Claude Code transcripts. Byte offset tracking, dedup. |
| **Stop Hook Handler** | HTTP handler on localhost. Batch extraction on session end. |
| **Startup Sweep** | On every serve launch, process unread transcript files |
| **Cloud API** | 8 endpoints (org CRUD, decisions CRUD, batch, dashboard, search) |
| **Qdrant Cloud** | Single collection, server-side MiniLM embeddings, hybrid search |
| **Cloudflare D1** | Org/member/invite storage |
| **Haiku enrichment** | Local async, classification (type/summary/affects/confidence). Cron for orphans. |
| **Seed-on-init** | CLAUDE.md + AGENTS.md + .cursorrules + git log. Batch endpoint + Queue. |
| **IDE auto-setup** | Claude Code + Cursor + Codex MCP configs |
| **CLAUDE.md injection** | Delimited markers, safe creation/update/removal |
| **Offline queue** | `~/.valis/pending.jsonl`, flush on reconnect |
| **Secret detection** | 10 regex patterns, block don't redact |
| **valis status** | Health check (cloud, API key, decision count) |
| **valis dashboard** | CLI report from cloud (counts, recent, by author) |
| **valis export** | JSON + Markdown export |
| **valis uninstall** | Clean removal via manifest.json |
| **Error handling** | Defined messages for all failure modes |

### NOT IN (by phase)

| Phase 2 (weeks 11-16) | Phase 3 (weeks 17-24) |
|---|---|
| Web dashboard (simple Vercel read-only) | Knowledge graph visualization |
| Slack integration | Meeting transcript capture |
| GitHub PR mining | PRD generation from knowledge |
| Contradiction detection | Onboarding doc generator |
| RBAC (roles beyond API keys) | SSO (SAML/OIDC) |
| Analytics (velocity, coverage) | SOC 2 Type II |
| OAuth login (GitHub) | Data residency (EU/US) |
| Cursor SQLite watcher | On-premise deployment |

---

## 6. Pricing

| Plan | Price | Includes |
|------|-------|----------|
| **Free** | $0 | Cloud storage, 500 decisions, 5 devs, 100 searches/day, no expiry |
| **Team** | $25/mo base + usage | 5,000 decisions, 50 devs, 1-year retention, web dashboard, RBAC |
| **Business** | $99/mo base + usage | Unlimited, SSO, audit logs, compliance reports, API |
| **Enterprise** | Custom | Data residency, SLAs, on-prem, custom integrations |

Usage overage: $0.005/decision, $0.002/search beyond plan limits.
Enforced server-side by Cloud API (D1 counters + KV rate limits).

---

## 7. Security

- **Tenant isolation**: single Qdrant collection, `org_id` payload filter, API-layer enforcement
- **API key never leaves local machine**: enrichment runs in MCP server process
- **Encryption**: at rest (Qdrant Cloud) + in transit (TLS 1.3)
- **Secret detection**: 10 regex patterns, block entire record if matched
- **Org API keys**: generated on create, rotatable via `valis config rotate-key`
- **Local config**: `~/.valis/config.json` with 0600 permissions
- **Orphan enrichment**: uses Valis's own Haiku key, not user's
- Phase 2: access logs, RBAC
- Phase 3: SSO, SOC 2, data residency

---

## 8. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| CLI + MCP Server | **Node.js + TypeScript** | MCP SDK is TS. Pure JS, zero native deps. |
| Cloud API | **Cloudflare Workers (Hono)** | Zero cold start, free tier, global edge |
| Org/member DB | **Cloudflare D1** | Relational, free, SQL |
| Rate limits | **Cloudflare KV** | Sub-5ms reads, approximate OK |
| Async enrichment | **Cloudflare Queues** | Batch seed processing, 15 min per batch |
| Orphan retry | **Cloudflare Cron Triggers** | Every 5 min, reliable |
| Vector storage | **Qdrant Cloud** | Server-side embeddings, hybrid search |
| Embedding model | **MiniLM-L6-v2 (384d)** | Via Qdrant Cloud Inference. 5M free tokens/mo. |
| Sparse search | **BM25 via Qdrant** | Unlimited free. Hybrid with dense. |
| Extraction | **Claude Haiku** (user's local key) | $0.001/call, 82-88% accuracy |
| License | **Apache 2.0** | Developer trust. Monetize cloud, not license. |

### Repo Structure

```
valis/
├── packages/
│   ├── cli/                # init, serve, status, dashboard, export, uninstall, config
│   └── cloud/              # Cloudflare Workers: API + Cron + Queue consumer
├── LICENSE                 # Apache 2.0
├── AGENTS.md               # Valis eats its own dogfood
├── package.json            # pnpm workspace
└── README.md
```

---

## 9. Competitive Positioning

| | memctl | Grov | ByteRover | **Valis** |
|---|---|---|---|---|
| Architecture | Pure MCP | Proxy + MCP | MCP daemon | **Pure MCP + Cloud** |
| Storage | Turso cloud | Supabase | Local markdown | **Qdrant Cloud** |
| Search | FTS5 + vector | OpenAI embeddings | Markdown search | **Hybrid (dense+BM25)** |
| Decision typing | ❌ flat text | ❌ flat text | ❌ flat text | **✅ typed + classified** |
| Hybrid search | FTS5 + vector | OpenAI embeddings | Markdown search | **✅ Qdrant dense + BM25 (server-side, no LLM needed)** |
| Seed-on-init | ❌ | ❌ | ❌ | **✅ Day 1 value** |
| Native deps | better-sqlite3 | better-sqlite3 | Go binary | **✅ Zero (pure JS)** |
| Offline support | Cloud-dependent | Proxy-dependent | Local-first | **✅ Queue + degrade** |
| Secret detection | ❌ | ❌ | ❌ | **✅ Block before store** |
| License | Apache 2.0 | Apache 2.0 | Freemium | **Apache 2.0** |

---

## 10. Go-To-Market

### Launch sequence

| Week | Action |
|------|--------|
| 1-3 | Cloud API + MCP server + file watcher + stop hook |
| 4-5 | CLI (init, seed, status, dashboard, export, uninstall) |
| 6-7 | Haiku enrichment + startup sweep + offline queue + polish |
| 8 | Dogfood on own team + install for 3-5 consulting clients |
| 9 | Iterate based on feedback |
| 10 | Show HN + Product Hunt + LinkedIn |
| 11-16 | Phase 2 (web dashboard, Slack, GitHub integration) |

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
| No auto-context in MCP protocol | HIGH | Seed critical decisions into CLAUDE.md. Instruction to call valis_context. Piggyback on first tool call. |
| Platform risk (Copilot Memory org scope) | HIGH | Ship fast. Differentiate on typed decisions + auto-capture + enrichment. |
| Market timing (6-12 month window) | HIGH | MVP in 8-10 weeks. Install for consulting clients first. |
| JSONL transcript format instability | HIGH | Version-aware parser. Graceful degradation on unknown format. |
| Claude Code deletes transcripts after 30 days | MEDIUM | Startup sweep processes files immediately. Set cleanupPeriodDays during init. |
| Qdrant Cloud dependency | MEDIUM | Offline queue. StorageAdapter allows future swap. |
| File watcher edge cases (WSL2, partial reads) | MEDIUM | Byte offset tracking. Polling fallback for WSL2. node-tail buffer pattern. |
| Haiku enrichment latency (3s P50) | LOW | Async — agent never waits. Cron catches orphans. |
| Free tier abuse | LOW | Server-side limits via KV + D1. |

---

## 12. Acceptance Criteria

1. `npm install -g valis` succeeds on macOS (ARM64 + Intel), Linux (x64), Windows — zero native compilation
2. `valis init` creates org + seeds + configures IDEs in <3 minutes
3. Dev A stores decision on Machine A → Dev B on Machine B finds it via `valis search`
4. Seed-on-init extracts 15+ decisions, init returns in <10 seconds (enrichment async)
5. Haiku enrichment produces type + summary + affects for >80% of stores within 5 minutes
6. `valis search "authentication"` finds a decision about JWT (via Qdrant hybrid search)
7. `valis dashboard` shows team activity from cloud (counts, recent, by author)
8. `valis export --json` produces valid, complete export of all org decisions
9. `valis uninstall` removes all configs cleanly, mentions cloud data persistence
10. Offline: `valis_store` queues locally, `valis_search` returns empty gracefully
11. Secret detection blocks storage of known key patterns (Anthropic, AWS, GitHub, etc.)
12. 3 private beta teams use it for 1 week without critical bugs

---

## 13. Error Messages

```
# Invalid API key
Error: Anthropic API key rejected (HTTP 401).
Check: https://console.anthropic.com/settings/keys
Valis stores raw decisions without enrichment until valid key is set.
Fix: valis config set api-key <your-key>

# Cloud unreachable
Warning: Valis Cloud unreachable.
Decisions queued locally (3 pending). Search unavailable offline.
Will sync automatically when connected.

# Org not found
Error: Organization not found.
Run: valis init (create new) or valis init --join CODE (join existing)

# Invite code invalid
Error: Invite code ACME-7X3K is invalid or expired.
Ask your team lead: valis org invite (generates new code)

# Free tier limit
Warning: Free tier limit reached (500/500 decisions).
New decisions will not be stored. Options:
  valis billing upgrade
  valis decisions prune --older-than 30d

# Haiku rate limited
Warning: Anthropic API rate limited. Enrichment paused.
Decisions stored as raw text. Enrichment retries automatically.

# Secret detected
Blocked: Secret detected (Anthropic API Key) in input.
Decision NOT stored. Remove the secret and try again.
```
