# Valis — Design Specification

**Date:** 2026-03-17
**Author:** Dmytro + Claude
**Status:** Approved for implementation

---

## 1. Product Overview

**Valis** — decision intelligence platform for engineering managers leading AI-augmented teams.

**One-liner:** MCP server that doesn't just store knowledge — it understands decisions, builds relationships, and alerts about drift.

**Problem:** An AI team of 5 devs generates decisions at a pace no engineering manager can track manually. Who decided what? Does it contradict what was decided yesterday? What's the full picture?

**Target buyer:** Engineering Manager / Tech Lead / CTO of small-to-mid teams (15-50 devs) where 50%+ of the team uses AI agents daily.

**Differentiator vs memctl (closest competitor):**
- memctl = flat text memory store (store text, search text, sync text)
- Valis = decision intelligence layer (typed decision objects with relationships, extraction intelligence, contradiction detection)

**Business model:**
- Open source core (BSL 1.1, Change Date: 2029-03-17 → Apache 2.0)
- Free: local Qdrant, CLI, MCP server, extraction engine
- Paid cloud: hosted storage, team sync, dashboard, security, integrations, analytics

**Eng Manager value prop:**
- Without Valis: "What did my 5 devs decide this week with AI agents?" → "I don't know, need to ask each one"
- With Valis: Dashboard → 47 decisions this week → 3 contradictions (red) → auth module = 12 decisions, payments = 0 (gap!) → API naming convention drift 23% over 2 weeks

---

## 2. Architecture

### Core Principle: Minimally Invasive

- Pure MCP — no proxy, no BASE_URL redirect, no stream interception
- IDE works directly with API as always
- If Valis process fails → IDE works normally, just without team knowledge
- `valis uninstall` → zero residue, IDE as before

### System Diagram

```
┌─────────────────────────────────────────────────────┐
│                    IDE / Agent                        │
│          (Claude Code, Cursor, Codex)                │
│                                                       │
│  CLAUDE.md / AGENTS.md / .cursorrules                │
│  "Store decisions via valis MCP tools"             │
└──────────────┬────────────────────────┬──────────────┘
               │ MCP (stdio)           │ MCP (stdio)
          write/store              read/search
               │                        │
┌──────────────▼────────────────────────▼──────────────┐
│                 Valis MCP Server                    │
│                 (Node.js process)                     │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ MCP Tools   │  │ Extraction   │  │ Hook        │ │
│  │             │  │ Engine       │  │ Handler     │ │
│  │ • store     │  │              │  │ (Claude     │ │
│  │ • search    │  │ raw text →   │  │  Code only) │ │
│  │ • context   │  │ structured   │  │              │ │
│  │ • graph     │  │ decision     │  │ Stop hook → │ │
│  │ • relate    │  │ object       │  │ transcript  │ │
│  │ • status    │  │ (Haiku)      │  │ analysis    │ │
│  │ • list      │  │              │  │              │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                │                  │        │
│  ┌──────▼──────────────────────────────────▼──────┐  │
│  │            Storage Adapter                      │  │
│  │                                                 │  │
│  │  ┌─────────────────┐  ┌──────────────────────┐ │  │
│  │  │ Valis Cloud   │  │ Local Qdrant (BYOB)  │ │  │
│  │  │ (default)       │  │ (free, self-hosted)  │ │  │
│  │  └─────────────────┘  └──────────────────────┘ │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

### MCP Tools (6 tools, MVP)

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `valis_store` | Store decision/pattern/constraint/lesson | `{text, type?, affects?, context?}` | `{id, structured_decision}` |
| `valis_search` | Find relevant knowledge | `{query, type?, limit?}` | `[{decision, score, relationships}]` |
| `valis_context` | Auto-context for current task | `{task_description, files?}` | `[{relevant_decisions}]` + summary |
| `valis_relate` | Link decisions | `{source_id, target_id, relation_type}` | `{relationship}` |
| `valis_status` | Change decision status | `{id, status: active/deprecated/superseded, reason?}` | `{updated_decision}` |
| `valis_list` | List decisions by filter | `{type?, status?, author?, affects?}` | `[{decisions}]` |

### Decision Object Schema

```typescript
interface Decision {
  id: string

  // Core
  type: 'decision' | 'constraint' | 'pattern' | 'lesson'
  summary: string           // "Use PostgreSQL for payment service"
  detail: string            // Full context with reasoning
  status: 'active' | 'deprecated' | 'superseded' | 'proposed'

  // Metadata
  author: string            // Who (dev or agent)
  source: 'agent_session' | 'slack' | 'pr_review' | 'meeting' | 'manual'
  created_at: Date
  updated_at: Date
  confidence: number        // 1-10, from extraction

  // Relationships
  affects: string[]         // ["payment-service", "order-api"]
  depends_on: string[]      // [decision_ids]
  contradicts: string[]     // [decision_ids] — auto-detected
  replaces: string[]        // [decision_ids]
  decided_by: string[]      // ["Oleg", "Maria"]

  // Vector
  embedding: number[]       // For semantic search
}
```

### Extraction Engine

When agent calls `valis_store({text: "We decided to use Redis for caching because..."})`:

1. **Classification** (Claude Haiku, user's API key):
   - Input: raw text
   - Output: `type`, `summary`, `detail`, `affects`, `confidence`
   - Cost: ~$0.001 per extraction

2. **Relationship detection** (Claude Haiku):
   - Search existing decisions for potential `contradicts` / `depends_on` / `replaces`
   - Flag contradictions → stored with relationship

3. **Embedding** (local FastEmbed, free):
   - Default: `all-MiniLM-L6-v2` (English, fast)
   - Option: `multilingual-e5-large` (multilingual, slower)

4. **Store** in Qdrant (cloud or local) with structured payload

### Hook Handler (Claude Code bonus, optional)

```json
{
  "hooks": {
    "Stop": [{
      "type": "http",
      "url": "http://localhost:9377/hook/stop"
    }]
  }
}
```

Stop hook → read `transcript_path` JSONL → post-session extraction → store decisions that agent didn't explicitly save. Safety net, not primary capture.

### Storage Adapter

```typescript
interface StorageAdapter {
  store(decision: Decision): Promise<string>
  search(query: string, filters?: Filters): Promise<Decision[]>
  get(id: string): Promise<Decision>
  update(id: string, changes: Partial<Decision>): Promise<Decision>
  relate(sourceId: string, targetId: string, type: RelationType): Promise<void>
  findContradictions(decision: Decision): Promise<Decision[]>
}

// Two implementations:
class ValisCloudAdapter implements StorageAdapter { /* Qdrant Cloud */ }
class LocalQdrantAdapter implements StorageAdapter { /* Local Qdrant */ }
```

### Setup Flow

```bash
$ npm install -g valis
$ valis init

  Detected: Claude Code, Cursor

  Storage:
  → [1] Valis Cloud (recommended, zero setup)
    [2] Local Qdrant (requires Docker)
    [3] Custom Qdrant URL

  Embedding model:
  → [1] English (fast, default)
    [2] Multilingual (slower, better for non-EN)

  ✅ Added MCP server to Claude Code
  ✅ Added MCP server to Cursor
  ✅ Added knowledge retention instructions to CLAUDE.md
  ✅ Added knowledge retention instructions to .cursorrules
  ✅ Installed Claude Code Stop hook (optional extraction)

  Ready! Your agents now share a team brain.
  Dashboard: https://app.valis.dev (after cloud signup)
```

```bash
$ valis uninstall
  ✅ Removed MCP configs
  ✅ Removed instructions from CLAUDE.md
  ✅ Removed hooks
  ✅ Your IDEs work as before. Zero residue.
```

---

## 3. MVP Scope & Phases

### MVP (Phase 1) — 2 weeks

**Goal:** Working product that a team of 3-5 devs can install and get value in 10 minutes.

**In scope:**
- `valis` CLI (init, uninstall, status)
- MCP server with 6 tools
- Extraction engine (Haiku → structured decisions)
- Relationship detection (contradicts, replaces)
- Local Qdrant adapter (BYOB)
- Valis Cloud adapter (hosted Qdrant)
- Auto-setup for Claude Code + Cursor + Codex
- Claude Code Stop hook (bonus extraction)
- Embedding: FastEmbed local (English + multilingual)
- Basic auth (API keys per org)

**NOT in scope:**
- Dashboard / Web UI
- Slack integration
- GitHub PR mining
- Meeting transcript capture
- Drift detection scoring
- Analytics / metrics
- SSO / SOC 2
- RBAC (beyond API keys)
- Data residency options
- Advanced search filters

**Acceptance criteria:**
1. `npm install -g valis && valis init` works in <2 minutes
2. Agent stores a decision → another agent in different IDE sees it via `valis_search`
3. Extraction correctly classifies type + affects + confidence in >60% of cases
4. Contradiction detection finds obvious conflicts (same `affects`, opposite `summary`)
5. Uninstall cleanly removes everything, IDEs work as before

### Phase 2 — "Intelligence Layer" — weeks 3-6

| Feature | Value for eng manager |
|---|---|
| Web dashboard | See all decisions, graph view, search |
| Knowledge graph visualization | Full picture: what depends on what |
| Contradiction alerts (email/Slack webhook) | "Decision #12 contradicts #47" — knows immediately |
| Staleness tracking | Decisions older than 90 days without validation → yellow flag |
| Coverage map | Which modules have 0 decisions = blind spots |
| Slack integration | Extract decisions from engineering channels |
| GitHub integration | Extract decisions from PR reviews |
| Team management (invite, roles) | Eng manager controls who has access |
| Security: tenant isolation | Organization data isolated, encrypted |
| Access logs | Who read/wrote what, when |

### Phase 3 — "Enterprise Ready" — weeks 7-14

| Feature | Value |
|---|---|
| Drift detection scoring | "Auth module drifting 23% from architecture" |
| Decision velocity analytics | How many decisions/week, who decides, trending |
| PRD generation from knowledge graph | "Generate PRD for payment refactoring" → PRD from all related decisions |
| Onboarding doc generator | New dev → "Here's everything decided about auth module" |
| Meeting transcript integration (Fireflies, Otter) | Decisions from meetings → knowledge graph |
| Linear/Jira linking | Decision → linked tickets |
| SSO (SAML/OIDC) | Enterprise requirement |
| Audit trail export | Compliance: who decided what when |
| Data residency (EU/US) | Enterprise requirement |
| SOC 2 Type II | Enterprise trust |
| API for custom integrations | Teams build their own connectors |

### Phase 4 — "Platform" — weeks 15+

| Feature | Value |
|---|---|
| Decision templates per industry/framework | "Rails decisions", "Microservices decisions" |
| Cross-org anonymized benchmarks | "Your decision velocity is top 20% for teams your size" |
| AI moderator | Auto-reviews decisions for quality, suggests improvements |
| Custom embedding models (BYOM) | Specialized domains |
| On-premise deployment | Enterprise self-hosted |
| Webhooks for all events | Custom workflow integrations |

---

## 4. Pricing

| Plan | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| **Free** | Local Qdrant, CLI, MCP, extraction, 1 project | Same + basic dashboard (read-only) | Same |
| **Team** ($20/dev/month) | Cloud storage, team sync, 5 projects | + Full dashboard, Slack, GitHub, alerts, RBAC | + Analytics, drift detection |
| **Enterprise** (custom) | — | — | SSO, SOC 2, audit, data residency, on-prem |

**Revenue targets:**
- Phase 2 launch: 10 paying teams × 10 devs × $20 = $2,000 MRR
- Phase 3 launch: 50 teams × 15 devs × $20 = $15,000 MRR
- Phase 4: first enterprise deal $2-5K/month

---

## 5. Security (Paid Cloud)

- **Tenant isolation** — each organization = separate Qdrant collection namespace, zero data mixing
- **Encryption** at rest (AES-256) + in transit (TLS 1.3)
- **Access logs** — who read/wrote what, when, from which IDE
- **API key rotation** with configurable TTL
- **Data residency** options: EU/US (Phase 3)
- **SSO** — SAML/OIDC (Phase 3)
- **SOC 2 Type II** certification (Phase 3)
- **Audit trail export** — PDF/CSV for compliance reviews

---

## 6. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| CLI + MCP Server | Node.js + TypeScript | MCP SDK is TypeScript. npm distribution. Same as Grov/memctl. |
| Extraction | Claude Haiku (user's API key) | Cheapest, fastest, proven by Grov. ~$0.001/extraction. |
| Embeddings | FastEmbed (local, free) | `all-MiniLM-L6-v2` default, `multilingual-e5-large` option. Zero API cost. |
| Vector Storage | Qdrant | Open source, cloud option, MCP ecosystem. |
| Cloud API | Qdrant Cloud + lightweight auth API | Minimal backend: Qdrant handles storage, we handle auth + team mgmt. |
| Dashboard (Phase 2) | Next.js | Fast to build, Vercel deploy. |
| Auth | API keys (MVP) → Better-auth (Phase 2) | Start simple, add OAuth later. |

---

## 7. Repo Structure

```
valis/
├── packages/
│   ├── cli/              # valis init, uninstall, status
│   ├── mcp-server/       # MCP tools (store, search, context, relate, status, list)
│   ├── extraction/       # Haiku extraction + classification + relationship detection
│   ├── storage/          # StorageAdapter interface + CloudAdapter + LocalQdrantAdapter
│   └── shared/           # Types, Decision schema, constants
├── LICENSE               # BSL 1.1
├── AGENTS.md             # Valis eats its own dogfood
├── package.json          # pnpm workspace
└── README.md
```

---

## 8. Competitive Landscape

### Direct competitors (Pure MCP team knowledge):

| Product | Stars | Approach | Differentiator vs Valis |
|---|---|---|---|
| memctl | 11 | Flat text memory, MCP, team sync | No structured decisions, no extraction intelligence, no relationships |
| ContextStream | 30 | MCP + integrations (Slack/Notion) | More integrations, but no decision typing or contradiction detection |
| Knowledge Plane | beta | Graph + vector, MCP, audit trail | Closest concept but pre-product, ~3 people, unfunded |

### Adjacent (different approach):

| Product | Approach | Why not a direct threat |
|---|---|---|
| Grov (175★) | Proxy-based capture | Invasive (breaks if proxy fails), Claude Code only for full capture |
| ByteRover | MCP daemon + context tree | No structured decisions, no relationships, no team dashboard |
| Archgate (9★) | Executable ADRs, CI enforcement | Manual ADR writing, no auto-extraction |
| Qodo Rules | Auto-learns from PR feedback | Code review only, no Slack/meetings, not MCP-native |

### Big player risk:

| Player | Current state | Risk level |
|---|---|---|
| GitHub Copilot Memory | Repo-specific, 28-day expiry, no decision structure | MEDIUM — could add decision features |
| Cursor Memories | IDE-specific, no cross-tool | LOW — walled garden |
| Anthropic Claude | MEMORY.md, auto-memory | LOW — individual, not team |

### Valis's moat:
1. **Structured decisions** (not flat text) — every competitor stores raw text
2. **Relationship graph** (depends_on, contradicts, replaces) — nobody does this
3. **Extraction intelligence** — raw text → classified, related decision object
4. **Eng manager dashboard** — competitors target developers, we target their managers
5. **Cross-source** (Phase 2+) — Slack + GitHub + meetings → one graph

---

## 9. Go-To-Market

### Launch sequence:

1. **Week 1-2:** Build MVP, dogfood on own team
2. **Week 3:** Private beta — 5 teams from LinkedIn network (Dmytro has 424K impressions track record)
3. **Week 4:** Show HN + Product Hunt + LinkedIn post ("I built X because Y")
4. **Week 5-6:** Iterate based on feedback, build Phase 2
5. **Week 7+:** Public launch, content marketing, conference talks

### Content strategy (leveraging existing LinkedIn presence):
- "75% of AI agents break working code. Here's what I built to fix it."
- "Your AI team makes 47 decisions/week. You see zero of them."
- "I gave my AI agents a shared brain. They stopped contradicting each other."

### Distribution channels:
- LinkedIn (existing audience: eng managers, CTOs)
- Hacker News Show HN
- Product Hunt
- GitHub (open source → organic discovery)
- Claude Code / Cursor / MCP communities
- Dev.to / Medium technical posts
