# VALIS Fundraising Roadmap

**Target:** $1M seed round
**Timeline:** 6-9 months from March 2026
**Author:** Todmy
**Last updated:** 2026-03-30

---

## Peter Thiel Assessment (Zero to One)

| Question | Score | Current State | Mitigation |
|----------|-------|---------------|------------|
| Engineering (10x?) | 5/10 | 2-3x vs CLAUDE.md | CI Enforcement (#33) = 10x moment. Blocks PRs, not just stores text. |
| Timing | 7/10 | MCP stable, window open but closing | Move fast: CI Enforcement + 10 users in 3 months. Be first to enforce. |
| Monopoly | 4/10 | 40+ competitors in broad niche | Micro-niche: TS teams 3-10 devs, Claude Code/Cursor, B2B SaaS. 50 teams = monopoly. |
| People | 3/10 | Solo founder = red flag | Antler (co-founder search + €100K). Or strong advisors (2-3, 0.5-1% each). |
| Distribution | 6/10 | PLG via MCP, conversion unproven | Free → paid trigger: shared decisions + CI enforcement. Target 5-10% conversion. |
| Durability | 6/10 | Moat potential, not built | Data moat from day 1 (200+ decisions = lock-in). Network moat from KB density (Phase 2). |
| Secret | 7/10 | Strong, unproven | "mem0 is HDD, VALIS is judicial system. Difference between remembering and enforcing." |

**Average: 5.4/10** — pre-seed idea with strong secret, needs traction.

---

## Investor Narrative

### One-liner
"VALIS enforces architectural decisions across AI coding agents — the linter for team knowledge."

### Problem (for pitch)
AI agents repeat architectural mistakes. 66% of devs spend more time fixing AI-generated code (Stack Overflow 2025). 44% blame context issues (Qodo 2025). CLAUDE.md is a bandaid — it documents but doesn't enforce.

### Secret sauce
The market thinks the problem is "store context." The real problem is "verify and enforce context." Raw text memory (mem0, memctl, Copilot Memory) doesn't scale because agents can't distinguish reliable decisions from outdated opinions. Typed decisions with provenance and CI enforcement — fundamentally different product.

### Competition framing
"We don't compete with mem0 or Copilot Memory. They store text. We enforce architectural decisions. Show me a competitor that blocks a PR when an agent violates a team decision." (Answer: only Archgate on ADRs, not on AI extraction.)

### Vision arc
Today: tool (decision intelligence for eng teams)
Year 2: platform (knowledge bases as network resources, HTTP API)
Year 4: network (agent-to-agent marketplace, "Hugging Face for knowledge bases")

### Market sizing
- TAM: 40M devs using AI coding agents x $20/dev/month = $9.6B
- SAM: 500K teams (3-10 devs, TypeScript/Python, AI-heavy) = $120M
- SOM: 5,000 teams in first 3 years = $1.2M ARR target for Series A

---

## Fundraising Phases

### Phase 0: Foundation (now → +2 months)

Parallel with day job.

| Action | Metric | Purpose |
|--------|--------|---------|
| Dog fooding on own projects | 200+ decisions stored | Case study + proof point |
| CI Enforcement (#33) working | 1 GitHub Action, public | 10x demo moment |
| 5-10 beta users (friends, colleagues, Twitter) | WAU | First traction signal |
| 2-3 technical posts (Dev.to, HN, Twitter/X) | Views, discussions | Thought leadership |
| Apply to **Antler** (Berlin/Amsterdam cohort) | Application submitted | Co-founder + €100K |

### Phase 1: Traction (+2 → +4 months)

| Action | Metric | Purpose |
|--------|--------|---------|
| Hacker News "Show HN" launch | 50+ active users | Validation signal |
| First paying customer | $20-100/month | Revenue > 0 |
| GitHub Action marketplace listing | Public installs | Distribution channel |
| Co-founder search active | 3-5 serious conversations | Team building |
| Apply to **Seedcamp** (London) | Application submitted | €500K + European network |

### Phase 2: Pre-Seed Ready (+4 → +6 months)

| Action | Metric | Purpose |
|--------|--------|---------|
| 50+ active users, 5+ paying teams | $500-2K MRR | Traction proof |
| Co-founder joined (or strong advisors) | Team >= 2 | Investor requirement |
| Case study with ROI | "X contradictions caught, Y incidents prevented" | Sales weapon |
| Pitch deck ready | 12 slides | Fundraising tool |
| Apply to **YC** or **Techstars** | Application submitted | $500K + network |

### Phase 3: Fundraise (+6 → +9 months)

| Action | Metric | Purpose |
|--------|--------|---------|
| Accelerator accepted (or direct raise) | $100-500K first check | Runway start |
| 20+ paying teams | $3-5K MRR | Growth signal |
| Seed round conversations | 10-15 investor meetings | Pipeline |
| **Close $1M seed** | SAFE or equity round | Full-time + team |

---

## Where to Apply

### Accelerators (ranked by relevance)

| Program | Check | Why it fits | When |
|---------|-------|-------------|------|
| **Antler** (Berlin/Amsterdam) | €100K for 12% | Helps find co-founder. Ideal for solo founder. | Now — cohorts every 3 months |
| **Seedcamp** (London) | €500K pre-seed | Strongest European pre-seed. B2B SaaS focus. | When 20+ users |
| **YC** (SF, remote ok) | $500K | Strongest brand. Competitive. | When paying customers exist |
| **Techstars** (various EU) | $120K | Good for first rounds, less competitive than YC. | When 10+ users |
| **EIC Accelerator** (EU grant) | €2.5M (70% grant, 30% equity) | Non-dilutive. Slow process (6-9 months), big check. | When traction + deck ready |

### Angel Investors

Look for angels who invested in: Vercel, Supabase, Railway, Neon, Linear, Raycast. They understand developer tools and AI.

- **AngelList** — create profile
- **Twitter/X** — dev tools angels publicly write "I invest in dev tools"
- **Through accelerator network** — after Antler/Seedcamp, get intros

### Seed Funds (developer tools focused)

| Fund | Stage | Focus |
|------|-------|-------|
| **Heavybit** (SF) | Seed | Developer tools exclusively |
| **Crane VC** (London) | Pre-seed/Seed | European developer infrastructure |
| **Point Nine** (Berlin) | Seed | B2B SaaS, European |
| **Moonfire** (London) | Pre-seed | European, AI-native |
| **Credo Ventures** (Prague) | Seed | CEE focused |

---

## Pitch Deck (12 slides)

1. **Problem:** AI agents repeat architectural mistakes. 66% devs fix AI code.
2. **Why now:** MCP standard, 40M+ devs with AI, no one enforces decisions.
3. **Solution:** VALIS — decision intelligence that enforces, not stores. Live demo: CI blocks PR.
4. **Secret sauce:** Typed decisions with provenance > raw text memory. "Judge, not diary."
5. **Market:** $9.6B TAM → $120M SAM → $1.2M SOM (3yr).
6. **Traction:** X users, Y decisions, Z contradictions caught, W paying teams.
7. **Business model:** Free (local) → Team $20/dev/month → Enterprise custom.
8. **Competition:** Matrix — "stores" vs "enforces" axis. VALIS alone in "enforces" quadrant.
9. **Vision:** Agent network. Today: tool. Year 2: platform. Year 4: network.
10. **Team:** Founder + co-founder + advisors.
11. **Ask:** $1M seed. 18 months runway.
12. **Use of funds:** 60% engineering, 25% GTM, 15% ops.

---

## $1M Budget Breakdown

```
Engineering (60% = $600K):
  Founder salary:     $100K/year
  3 engineers:        $300K/year (€75-85K each, European market)
  Infrastructure:     $50K/year (Qdrant Cloud, Supabase Pro, Vercel Pro)

GTM (25% = $250K):
  1 DevRel/Marketing: $80K/year
  Content/Ads:        $50K/year
  Conferences:        $20K/year

Ops (15% = $150K):
  Legal/Accounting:   $30K
  Office/Tools:       $20K
  Buffer:             $100K

Runway: ~14-16 months to Series A metrics
Series A target: $1.2M ARR, 200+ paying teams, proven expansion motion
```

---

## Key Metrics to Track

| Metric | Phase 0 | Phase 1 | Phase 2 | Phase 3 (fundraise) |
|--------|---------|---------|---------|---------------------|
| Active users (WAU) | 5-10 | 50+ | 100+ | 200+ |
| Paying teams | 0 | 1+ | 5+ | 20+ |
| MRR | $0 | $20-100 | $500-2K | $3-5K |
| Decisions stored (total) | 500 | 5K | 20K | 50K+ |
| Contradictions caught/week | Manual count | 10+ | 50+ | 200+ |
| CI blocks/week | 0 | First ones | Regular | Standard feature |

---

## Decision Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-03-30 | Target $1M seed, not smaller | Need $100K founder salary + 3-4 engineers + GTM. $100K insufficient. |
| 2026-03-30 | Antler as first accelerator | Solves biggest weakness (solo founder) + provides initial capital. |
| 2026-03-30 | CI Enforcement as 10x demo | Only feature that transforms VALIS from documentation to infrastructure. |
| 2026-03-30 | European funds priority | Founder is Ukraine-based, European B2B context, lower burn rate. |
