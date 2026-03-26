# Valis

Shared decision intelligence for AI-augmented engineering teams.

Valis captures, stores, searches, and pushes team decisions across developer sessions. Your AI coding agent remembers what the team decided — so nobody asks "why did we choose PostgreSQL?" twice.

## Install

```bash
npm install -g valis
```

**Prerequisites**: Node.js 20+.

## Quickstart (30 seconds)

```bash
# 1. Create your team's brain (no credentials needed)
valis init

# 2. Share the invite code with teammates
valis init --join ACME-7X3K

# 3. Your IDE's AI agent now has team memory
# valis_store, valis_search, valis_context — all automatic
```

**Hosted mode** (recommended): Just enter your org name, project name, and your name. No API keys, no config files, no environment variables needed. The registration API handles everything.

**Community mode** (self-hosted): Your data stays on your infrastructure.

```bash
cd community && docker compose up -d   # Start Postgres + Qdrant locally
valis init                            # Choose Community, enter localhost URLs
```

See [community/README.md](community/README.md) for full self-hosted setup guide.

## Features

- **Zero-config onboarding**: `valis init` registers via public API — no credentials, no `.env` files
- **Auto-capture**: Decisions captured automatically through channel reminders, keyword triggers, and session sweep
- **DESIGN.md seeding**: On init, parses DESIGN.md files alongside CLAUDE.md, AGENTS.md, and git history to pre-populate the knowledge base
- **Hybrid search**: Dense + BM25 sparse search via Qdrant Cloud with server-side embeddings
- **Search intelligence**: Content-aware decay, two-stage reranking (multi-signal scoring), query analysis, graph-augmented search, contextual retrieval, HyPE indexing, and query expansion
- **Knowledge compression**: Decision clustering with `valis admin clusters`, pattern consolidation with `valis admin consolidate`
- **Dual storage**: Supabase Postgres (source of truth) + Qdrant Cloud (search)
- **MCP tools**: `valis_store`, `valis_search`, `valis_context`, `valis_lifecycle` — works with Claude Code, Codex, Cursor
- **Offline resilient**: Decisions queued locally when offline, synced on reconnect
- **Secure**: Per-member API keys (`tmm_` prefix), no service_role keys on client machines. 10 secret detection patterns block API keys/passwords before storage
- **Zero native deps**: Pure JS/TS, installs everywhere without node-gyp
- **Free tier**: 2 members, 100 decisions/mo, 100 searches/day. Paid plans: Team ($29/mo), Business ($99/mo), Enterprise (custom)

## CLI Commands

| Command | Description |
|---------|-------------|
| `valis init` | Create or join an organization |
| `valis init --join <code>` | Join a project via invite code |
| `valis serve` | Start MCP + Channel server (with realtime push) |
| `valis status` | Show system health, realtime status, auth mode |
| `valis dashboard` | Show team activity, lifecycle stats, dependency warnings |
| `valis search <query>` | Search decisions (`--all` for suppressed, `--all-projects` for cross-project) |
| `valis config set/get` | Manage configuration |
| `valis switch --join <code>` | Switch to a different org |
| `valis switch --project <name>` | Switch to a different project in current org |
| `valis migrate-auth` | Migrate from org-level to per-member JWT auth |
| `valis enrich` | Classify pending decisions via LLM (optional) |
| `valis upgrade` | Upgrade plan via Stripe Checkout |
| `valis admin metrics` | Platform-wide observability metrics |
| `valis admin audit` | View audit trail for an org |
| `valis admin cleanup` | Detect and clean duplicate/orphan decisions |
| `valis admin patterns` | Detect decision patterns from clusters |
| `valis admin clusters` | View decision clusters and similarity groups |
| `valis admin consolidate` | Merge redundant decisions into consolidated entries |
| `valis admin migrate-qdrant` | Backfill project_id into Qdrant points |
| `valis uninstall` | Clean removal |

## Phase 2 Features

- **Decision lifecycle**: Deprecate outdated decisions, promote proposed ones to active, supersede with replacements. Full status history via `valis_lifecycle`.
- **Cross-session push**: Real-time notifications via Supabase Realtime when teammates store or deprecate decisions. Dedup suppresses echoes from the local session.
- **Per-member auth**: JWT-based authentication with per-member API keys (`tmm_` prefix). Migrate from org-level keys via `valis migrate-auth`. Key rotation and revocation via Edge Functions.
- **Contradiction detection**: Two-tier detection (area overlap + Qdrant cosine similarity) flags conflicting active decisions on store. Contradictions auto-resolve when decisions are deprecated/superseded.
- **Platform metrics**: Operator dashboard with activation funnel, per-org COGS, churn/at-risk tracking, and active member counts via `valis admin metrics`.
- **Audit trail**: Full audit log of decision stores, status changes, key rotations, and member events via `valis admin audit`.
- **Registration API**: Public endpoint creates org + project + member atomically. No credentials needed for hosted mode onboarding.

## How It Works

1. **Init**: Registers with Valis hosted (or self-hosted Supabase), configures your IDE's MCP server, seeds initial decisions from CLAUDE.md, DESIGN.md, AGENTS.md, and git history
2. **Capture**: Your AI agent calls `valis_store` when decisions are made. Activity watcher sends reminders. Session-end hooks catch what was missed.
3. **Search**: `valis_search` and `valis_context` query the team brain via hybrid search. Results ranked by relevance.
4. **Push**: New decisions push notifications to active team sessions via channels.

## Architecture

```
Agent <-> MCP (stdio) <-> Valis CLI <-> Vercel API Routes / Supabase Postgres + Qdrant Cloud
```

- **CLI package**: TypeScript, commander, @modelcontextprotocol/sdk
- **Web package**: Next.js on Vercel — API routes (`/api/*`) replace Supabase Edge Functions for hosted mode
- **Storage**: Supabase (Postgres) + Qdrant Cloud (search)
- **API**: Hosted mode routes through Vercel API routes (`https://valis.krukit.co/api/*`). Community/self-hosted mode continues using Supabase Edge Functions (`/functions/v1/*`).
- **Auth**: Per-member API keys via registration API, JWT tokens via exchange-token
- **Transport**: stdio (MCP standard)

## Development

```bash
git clone git@github.com:Todmy/valis.git
cd valis
pnpm install
pnpm build
pnpm test
```

## License

Apache 2.0
