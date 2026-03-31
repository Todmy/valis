# VALIS — Project Pitch

> **"The linter for team knowledge. AI agents share one brain."**

---

## Problem

AI coding agents are transforming software development — but they have amnesia.

- **66%** of developers spend more time *fixing* AI-generated code than writing it (Stack Overflow 2025)
- **44%** blame lack of context as the root cause (Qodo 2025)
- Teams of 5+ developers generate decisions faster than any engineering manager can track
- Yesterday's architectural decision? Your agent doesn't know about it. It will make the same mistake again.

**CLAUDE.md is a bandaid.** It documents decisions but doesn't enforce them. Agents can't distinguish reliable decisions from outdated opinions.

---

## Solution

**VALIS** is a shared decision intelligence platform for AI-augmented engineering teams.

```
Developer A makes a decision → VALIS captures it → Developer B's agent knows it instantly
```

### How it works

1. **Auto-capture** — Three-layer system detects decisions from developer sessions (80%+ coverage)
2. **Hybrid search** — Dense embeddings + BM25 via Qdrant deliver relevant context in milliseconds
3. **Cross-session push** — Decisions propagate to all team members in real-time via Supabase Realtime
4. **Contradiction detection** — Flags conflicting decisions before they cause damage
5. **CI Enforcement** *(coming)* — GitHub Action that **blocks PRs** violating team decisions

### Zero-config onboarding

```bash
npx valis init        # Register via public API — no .env, no API keys
# That's it. Your agent now shares the team brain.
```

Works with **Claude Code**, **Codex**, and **Cursor** via MCP protocol.

---

## Secret Sauce

> *"mem0 is a hard drive. VALIS is a judicial system. The difference between remembering and enforcing."*

The market thinks the problem is *"store context."* The real problem is *"verify and enforce context."*

| | Raw text memory (mem0, memctl, Copilot Memory) | VALIS |
|---|---|---|
| Storage | Flat text blobs | Typed decisions with provenance, status, and lifecycle |
| Retrieval | Keyword match | Hybrid search with content-aware decay and reranking |
| Enforcement | None | CI blocks PRs violating team decisions |
| Collaboration | Per-user silos | Shared team knowledge with real-time sync |
| Trust | Can't distinguish fresh from stale | Active/deprecated/superseded lifecycle |

**Show me a competitor that blocks a PR when an agent violates a team decision.** There isn't one.

---

## Market

| Tier | Size | Calculation |
|------|------|-------------|
| **TAM** | $9.6B | 40M devs using AI agents × $20/dev/month |
| **SAM** | $120M | 500K teams (3-10 devs, TS/Python, AI-heavy) |
| **SOM** | $1.2M ARR | 5,000 teams in 3 years |

**Timing is now:** MCP protocol just standardized. 40M+ devs use AI daily. The enforcement layer doesn't exist yet. First mover wins.

---

## Product — What's Built

### ✅ Live (MVP + Phase 2)

| Feature | Status |
|---------|--------|
| MCP server with `store`, `search`, `context` tools | Shipped |
| Supabase Postgres + Qdrant Cloud dual storage | Shipped |
| Auto-capture via CLAUDE.md triggers + channel reminders + startup sweep | Shipped |
| DESIGN.md seeding (15-30 decisions from existing docs) | Shipped |
| Zero-config `valis init` onboarding | Shipped |
| Web dashboard ([valis.krukit.co](https://valis.krukit.co)) | Shipped |
| Per-member JWT auth + API keys | Shipped |
| Device authorization flow (`valis login`) | Shipped |
| Contradiction detection (area overlap + cosine similarity) | Shipped |
| Project member management + email invites | Shipped |
| Secret detection (10 patterns — blocks API keys before storage) | Shipped |
| Offline resilience (local queue, sync on reconnect) | Shipped |
| Self-hosted option (Docker Compose) | Shipped |

### 🔜 Next (Phase 3-4)

| Feature | Impact |
|---------|--------|
| **CI Enforcement** — GitHub Action blocks PRs violating decisions | **10× differentiation moment** |
| PR Review Auto-Capture — extract decisions from code reviews | Grow knowledge base passively |
| Billing integration (Stripe) | Revenue |
| Knowledge Bases — namespace layer for organizing decisions | Enterprise readiness |

---

## Business Model

| Tier | Price | Limits |
|------|-------|--------|
| **Free** | $0 | 2 members, 100 decisions/month, 100 searches/day |
| **Team** | $29/month | Unlimited decisions, real-time push, CI enforcement |
| **Business** | $99/month | Advanced analytics, priority support |
| **Enterprise** | Custom | SSO, dedicated infra, SLA |

**PLG motion:** Free tier → shared decisions trigger Team upgrade → CI enforcement triggers Business upgrade.

**Data moat:** 200+ decisions = lock-in. Knowledge compounds — switching cost grows with usage.

---

## Vision

```
Today:     TOOL        — Decision intelligence for engineering teams
Year 2:    PLATFORM    — Knowledge bases as network resources, HTTP API
Year 4:    NETWORK     — Agent-to-agent marketplace ("Hugging Face for knowledge bases")
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| CLI + MCP Server | TypeScript, Node.js 20+, Commander, MCP SDK |
| Web Dashboard | Next.js 15, React 19, Tailwind CSS |
| Database | Supabase Postgres (RLS, 7 migrations) |
| Search | Qdrant Cloud (dense + BM25 hybrid) |
| Real-time | Supabase Realtime |
| Auth | Supabase Auth + JWT (`jose`) + Device Auth (RFC 8628) |
| Hosting | Vercel (web) + Supabase (backend) |
| Self-hosted | Docker Compose (PostgreSQL 16 + Qdrant 1.12) |

**Zero native dependencies.** Pure JS/TS — installs everywhere without node-gyp.

---

## Competition

```
                    Stores              Enforces
                    ──────              ────────
  Per-user          mem0                   —
                    memctl
                    Copilot Memory

  Team-shared       —                   VALIS ★
```

VALIS occupies the only quadrant that matters: **team-shared + enforced**.

---

## Traction (Current)

- 🏗️ Product shipped and deployed at [valis.krukit.co](https://valis.krukit.co)
- 📦 15+ API routes live on Vercel
- 🗄️ 7 database migrations deployed
- 🔒 Auth, member management, email invites — all working
- 🐕 Dog fooding in progress on own projects

---

## Ask

**$1M seed round** — 18 months runway to Series A metrics.

| Allocation | Amount | Purpose |
|------------|--------|---------|
| Engineering (60%) | $600K | Founder + 3 engineers |
| GTM (25%) | $250K | DevRel + content + conferences |
| Ops (15%) | $150K | Legal, infra, buffer |

### Series A target
- $1.2M ARR
- 200+ paying teams
- Proven expansion motion
- CI Enforcement as standard feature

---

## Founder

**Todmy** — Full-stack engineer, built VALIS from 0 to shipped product solo.

- Designed architecture spanning CLI, MCP protocol, web dashboard, and self-hosted deployment
- 8 feature specs delivered across auth, search, billing, multi-project, and member management
- Deep domain expertise in AI-augmented development workflows

---

## Next Steps

1. **Now → +2 months:** Dog fooding, CI Enforcement MVP, 5-10 beta users
2. **+2 → +4 months:** Show HN launch, first paying customer, co-founder search
3. **+4 → +6 months:** 50+ users, 5+ paying teams, pitch deck finalized
4. **+6 → +9 months:** Accelerator / seed round close

---

*VALIS — because AI teams deserve better than copy-pasting into CLAUDE.md.*
