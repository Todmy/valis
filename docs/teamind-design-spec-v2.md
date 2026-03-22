# Teamind — Design Specification v2 (Final)

**Date:** 2026-03-17
**Status:** Final — approved for implementation after 3 iterations of review
**Identity:** Team Brain from Day 1

---

## 1. Product Overview

**Teamind** — shared decision intelligence for AI-augmented engineering teams.

**One-liner:** Your team's AI agents share one brain. Decisions made in one session are available in every session, for every developer.

**Problem:** AI team of 5 devs generates decisions at a pace no engineering manager can track. Who decided what? Does it contradict yesterday? What's the full picture?

**Target:** Engineering Manager / Tech Lead / CTO. Teams 15-50 devs, 50%+ using AI agents daily.

**Differentiator vs memctl:** memctl = flat text memory. Teamind = typed decision objects (decision/constraint/pattern/lesson) with relationships, Haiku classification, keyword-enriched search.

---

## 2. Architecture

### Core Principle: Cloud-First, Minimally Invasive

- Cloud backend from Day 1 (team sync, org management, shared storage)
- Pure MCP — no proxy, no BASE_URL redirect, no stream interception
- If Teamind process fails → IDE works normally
- `teamind uninstall` → zero residue

### System Diagram

```
┌─────────────────────────────────────────────┐
│              IDE / Agent                     │
│     (Claude Code, Cursor, Codex)            │
│                                              │
│  CLAUDE.md / AGENTS.md / .cursorrules       │
│  "Store decisions via teamind tools"        │
└──────────┬──────────────────┬───────────────┘
           │ MCP (stdio)      │ MCP (stdio)
      write/store         read/search
           │                  │
┌──────────▼──────────────────▼───────────────┐
│         Teamind MCP Server                   │
│         (`teamind serve`)                    │
│         Per-session process (~200ms start)   │
│                                              │
│  ┌──────────┐  ┌────────────────────────┐   │
│  │ 3 MCP    │  │ Async Enrichment       │   │
│  │ Tools    │  │                        │   │
│  │          │  │ After store returns:   │   │
│  │ store    │  │ → Haiku classifies     │   │
│  │ search   │  │ → Haiku adds keywords  │   │
│  │ context  │  │ → Updates record       │   │
│  └────┬─────┘  └───────────┬────────────┘   │
│       │                    │                │
│  ┌────▼────────────────────▼────────────┐   │
│  │     Teamind Cloud API                │   │
│  │     (Qdrant Cloud + Auth + Org)      │   │
│  │                                      │   │
│  │  • Org/team management              │   │
│  │  • Invite codes                     │   │
│  │  • Qdrant Cloud (vector + payload)  │   │
│  │  • Tenant isolation per org         │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### MCP Tools (3 tools)

| Tool | What | Latency | Cost |
|------|------|---------|------|
| `teamind_store` | Store raw text → return {id, status: "stored"} → async Haiku enrichment | <50ms (store) + 3s async (Haiku, invisible to agent) | ~$0.001 |
| `teamind_search` | FTS5 + BM25 over Haiku-enriched keywords | <100ms | $0 |
| `teamind_context` | Auto-find relevant decisions for current task | <200ms | $0 |

### Store-Then-Enrich Pattern

```
Agent calls teamind_store({text: "We decided to use Redis for caching"})
  │
  ├─ SYNC (agent waits):
  │   → Store raw text to Qdrant Cloud (<50ms)
  │   → Return {id, type: "pending", summary: text.slice(0,100)}
  │
  └─ ASYNC (agent does NOT wait):
      → Haiku classifies: type, summary, detail, affects, confidence
      → Haiku generates search_keywords (10-15 synonyms/concepts)
      → Update record in Qdrant Cloud
      → If enrichment fails: record stays as raw text, retried on next process start
```

### Decision Object Schema

```typescript
interface Decision {
  id: string

  // Core
  type: 'decision' | 'constraint' | 'pattern' | 'lesson' | 'pending'
  summary: string
  detail: string
  status: 'active' | 'deprecated' | 'superseded' | 'proposed'

  // Metadata
  author: string
  source: 'agent_session' | 'seed' | 'manual'
  project_id: string
  org_id: string
  created_at: Date
  updated_at: Date
  confidence: number        // 1-10
  extraction_status: 'pending' | 'enriched' | 'failed'

  // Enriched by Haiku (async)
  affects: string[]
  search_keywords: string[] // 10-15 synonyms/concepts for FTS5

  // Relationships (Phase 2)
  depends_on: string[]
  contradicts: string[]
  replaces: string[]
  decided_by: string[]

  // Vector (stored in Qdrant)
  // Embedding generated server-side by Qdrant Cloud
}
```

---

## 3. Cloud Backend (MVP)

### Minimal Cloud API (5 endpoints)

```
POST   /orgs                    # Create org, returns org_id + invite_code
POST   /orgs/:id/join           # Join org with invite code
GET    /orgs/:id/members        # List members
POST   /orgs/:id/decisions      # Store decision (proxy to Qdrant)
POST   /orgs/:id/search         # Search decisions (proxy to Qdrant)
```

### Infrastructure

| Component | Choice | Why |
|-----------|--------|-----|
| API Server | Cloudflare Workers (or Hono on Fly.io) | Cheap, fast, serverless, zero cold start |
| Auth | API keys per org (MVP) → OAuth Phase 2 | Simplest. Key generated on org create. |
| Storage | Qdrant Cloud | Vector + payload, tenant isolation via collection-per-org |
| Embedding | Qdrant Cloud built-in (FastEmbed on server side) | User doesn't need local embeddings |

### Tenant Isolation

- Each org = separate Qdrant collection (e.g., `org_{org_id}`)
- API key scoped to org
- No data mixing between orgs
- Encryption at rest (Qdrant Cloud default)

### Cost to Run

| Component | Cost |
|-----------|------|
| Qdrant Cloud free tier | 1GB RAM, 4GB disk — enough for ~50K decisions |
| Cloudflare Workers free | 100K requests/day |
| Haiku extraction | ~$0.001/decision, paid by user's API key |
| **Total infra for MVP** | **~$0/month** until significant scale |

---

## 4. Setup Flow

```bash
$ npm install -g teamind

$ teamind init

  Welcome to Teamind — shared brain for your AI team.

  [1] Create new organization
  [2] Join existing organization (invite code)

  > 1

  Organization name: acme-eng
  ✅ Created org "acme-eng"
  📋 Invite code: ACME-7X3K (share with your team)

  Detected IDEs: Claude Code, Cursor

  Enter Anthropic API key (for decision enrichment):
  sk-ant-...
  ✅ API key valid

  Seeding knowledge base...
  → Parsed CLAUDE.md: 12 decisions found
  → Parsed .cursorrules: 3 patterns found
  → Parsed AGENTS.md: 2 constraints found
  → Scanned git log (50 commits): 5 decisions found
  ✅ Seeded 22 decisions into your team brain

  Configuring IDEs...
  ✅ Added MCP server to Claude Code
  ✅ Added MCP server to Cursor
  <!-- teamind:start -->
  ✅ Added instructions to CLAUDE.md
  <!-- teamind:end -->
  ✅ Added instructions to .cursorrules

  Verification...
  ✅ Stored test decision
  ✅ Search found test decision
  ✅ Teamind is working!

  Next steps:
  • Share invite code ACME-7X3K with your team
  • Start coding — your AI agent now remembers team decisions
  • Run `teamind status` anytime to check health
  • Run `teamind dashboard` for a summary
```

### For team members joining:

```bash
$ npm install -g teamind
$ teamind init --join ACME-7X3K
  ✅ Joined org "acme-eng"
  ✅ 22 team decisions already available
  ... (same IDE configuration)
```

---

## 5. MVP Scope

### IN (5-6 weeks)

| Component | Details |
|-----------|---------|
| `teamind` CLI | init, init --join, status, dashboard, export, uninstall |
| `teamind serve` | MCP server (3 tools: store, search, context) |
| Cloud API | 5 endpoints (org create/join, store, search, members) |
| Haiku enrichment | Async store-then-enrich (classification + keywords) |
| Seed-on-init | CLAUDE.md + AGENTS.md + .cursorrules + git log parsing |
| Qdrant Cloud storage | Per-org collection, server-side embeddings |
| IDE auto-setup | Claude Code + Cursor + Codex MCP configs |
| CLAUDE.md injection | Delimited markers `<!-- teamind:start/end -->` |
| `teamind status` | Health check (API key, cloud connectivity, decisions count) |
| `teamind dashboard` | CLI report (pulls from cloud: team decisions, counts, recent activity) |
| `teamind export` | JSON + Markdown export of all decisions |
| `teamind uninstall` | Clean removal via manifest.json tracking |
| Error handling | 3s Haiku timeout → store raw, retry later. Offline → queue locally. |
| Input validation | Min 10 chars before Haiku. Secret detection (regex). |

### NOT IN MVP (Phase 2+)

| Feature | Phase |
|---------|-------|
| Web dashboard + knowledge graph viz | Phase 2 |
| Slack integration | Phase 2 |
| GitHub PR mining | Phase 2 |
| Contradiction detection | Phase 2 |
| Drift detection | Phase 3 |
| SSO / SOC 2 | Phase 3 |
| RBAC (beyond API keys) | Phase 2 |
| Meeting transcript capture | Phase 3 |
| Analytics (velocity, coverage) | Phase 2 |
| Stop hook transcript extraction | Phase 2 |
| File watcher (JSONL/SQLite) | Phase 3 |

---

## 6. Pricing

| Plan | Price | Includes |
|------|-------|----------|
| **Free** | $0 | Cloud storage, 500 decisions, 5 devs, 1 org, 100 searches/day, 30-day retention, CLI dashboard |
| **Team** | $25/mo base + usage | 5,000 decisions, 50 devs, 5 orgs, unlimited search, 1-year retention, web dashboard, RBAC |
| **Business** | $99/mo base + usage | Unlimited decisions, SSO, audit logs, unlimited retention, compliance reports, API access |
| **Enterprise** | Custom | Data residency, SLAs, on-prem, custom integrations |

Usage overage: $0.005/decision stored, $0.002/search beyond plan limits.

Free tier limits enforced server-side by cloud API. No local enforcement needed.

---

## 7. Security

- Tenant isolation: separate Qdrant collection per org
- Encryption at rest (Qdrant Cloud default) + in transit (TLS)
- API keys per org, rotatable
- Secret detection: regex-based scanning before storage (API keys, tokens, passwords → redacted)
- Access logs: who stored/searched what, when (Phase 2)
- Data residency: EU/US (Phase 3)
- SOC 2 Type II (Phase 3)

---

## 8. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| CLI + MCP Server | Node.js + TypeScript | MCP SDK is TypeScript. npm distribution. |
| Cloud API | Cloudflare Workers (Hono framework) | Zero cold start, free tier generous, global edge |
| Vector Storage | Qdrant Cloud | Vector + payload, per-collection isolation, built-in FastEmbed |
| Embeddings | Qdrant Cloud server-side FastEmbed | User doesn't need local embedding model |
| Extraction | Claude Haiku (user's API key) | $0.001/call, 82-88% accuracy, async |
| Auth (MVP) | API keys per org | Simple, no OAuth complexity |
| Auth (Phase 2) | Better-auth (GitHub OAuth) | Team management UI |
| Web Dashboard (Phase 2) | Next.js on Vercel | Fast to build, SSR |
| License | BSL 1.1 (→ Apache 2.0 after 3 years) | Protects cloud business |

### Repo Structure (2 packages)

```
teamind/
├── packages/
│   ├── cli/                # teamind init/serve/status/dashboard/export/uninstall
│   └── cloud/              # Cloudflare Workers API (5 endpoints)
├── LICENSE                 # BSL 1.1
├── AGENTS.md               # Teamind eats its own dogfood
├── package.json            # pnpm workspace
└── README.md
```

---

## 9. Competitive Positioning

| | memctl | Grov | ByteRover | **Teamind** |
|---|---|---|---|---|
| Architecture | Pure MCP | Proxy + MCP | MCP daemon | **Pure MCP + Cloud** |
| Storage | Turso (cloud) | Supabase | Local markdown | **Qdrant Cloud** |
| Team sync | Cloud | Cloud | Cloud | **Cloud (Day 1)** |
| Decision typing | ❌ flat text | ❌ flat text | ❌ flat text | **✅ typed objects** |
| Keyword enrichment | ❌ | ❌ | ❌ | **✅ Haiku-generated** |
| Extraction | None (raw store) | Haiku (proxy capture) | LLM (daemon) | **Haiku (async enrich)** |
| Seed-on-init | ❌ | ❌ | ❌ | **✅** |
| Search quality | FTS5 | Hybrid (OpenAI embeddings) | Markdown search | **FTS5 + keywords + vector** |
| License | Apache 2.0 | Apache 2.0 | Freemium | **BSL 1.1** |
| Stars | 11 | 175 | N/A | **New** |

---

## 10. Go-To-Market

### Launch sequence

1. **Week 1-2:** Cloud API + MCP server + CLI
2. **Week 3-4:** Seed-on-init + Haiku enrichment + polish
3. **Week 5:** Dogfood on own team + 3 private beta teams
4. **Week 6:** Show HN + Product Hunt + LinkedIn post
5. **Week 7-10:** Iterate, add web dashboard (Phase 2)

### Content hooks (LinkedIn)

- "Your AI team makes 47 decisions/week. You see zero of them."
- "I gave my AI agents a shared brain. They stopped contradicting each other."
- "75% of AI agents break working code. Here's what I built."

### Distribution

- LinkedIn (existing audience: eng managers, CTOs)
- Show HN + Product Hunt
- GitHub (BSL open source → organic discovery)
- MCP server directories (mcpmarket.com, pulsemcp.com)
- r/ClaudeCode, r/cursor communities

---

## 11. Risks (Known, Accepted)

| Risk | Severity | Mitigation |
|------|----------|------------|
| better-sqlite3 install failures (15-25%) | HIGH | Document workarounds. Consider sql.js fallback in Phase 2 |
| CLAUDE.md compliance 10-20% | HIGH | Seed-on-init provides Day 1 value. Haiku enrichment runs regardless. Stop hook in Phase 2 for auto-capture |
| Qdrant Cloud dependency | MEDIUM | StorageAdapter interface allows swap. Local Qdrant as BYOB option |
| Platform risk (Copilot Memory org scope) | HIGH | Ship fast. Differentiate on typed decisions + relationships |
| Haiku latency 3s for enrichment | LOW | Async — agent never waits |
| Market timing (6-12 month window) | HIGH | MVP in 6 weeks, iterate fast |
| Free tier abuse | LOW | Server-side limits (500 decisions, 5 devs) |

---

## 12. Acceptance Criteria (MVP)

1. `npm install -g teamind && teamind init` works in <3 minutes
2. Dev A stores decision → Dev B on different machine searches and FINDS it
3. Seed-on-init extracts 15+ decisions from existing project files
4. Haiku enrichment produces type + keywords for >80% of stores
5. `teamind search "authentication"` finds a decision about JWT (via keywords)
6. `teamind dashboard` shows team activity (decisions count, recent, by author)
7. `teamind export --json` produces valid, complete export
8. `teamind uninstall` removes all configs cleanly
9. 3 private beta teams use it for 1 week without critical bugs
