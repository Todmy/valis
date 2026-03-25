# Teamind

Shared decision intelligence for AI-augmented engineering teams.

Teamind captures, stores, searches, and pushes team decisions across developer sessions. Your AI coding agent remembers what the team decided — so nobody asks "why did we choose PostgreSQL?" twice.

## Install

```bash
npm install -g teamind
```

**Prerequisites**: Node.js 20+.

## Quickstart (30 seconds)

```bash
# 1. Create your team's brain (no credentials needed)
teamind init

# 2. Share the invite code with teammates
teamind init --join ACME-7X3K

# 3. Your IDE's AI agent now has team memory
# teamind_store, teamind_search, teamind_context — all automatic
```

**Hosted mode** (recommended): Just enter your org name, project name, and your name. No API keys, no config files, no environment variables needed. The registration API handles everything.

**Community mode** (self-hosted): Your data stays on your infrastructure.

```bash
cd community && docker compose up -d   # Start Postgres + Qdrant locally
teamind init                            # Choose Community, enter localhost URLs
```

See [community/README.md](community/README.md) for full self-hosted setup guide.

## Features

- **Zero-config onboarding**: `teamind init` registers via public API — no credentials, no `.env` files
- **Auto-capture**: Decisions captured automatically through channel reminders, keyword triggers, and session sweep
- **Hybrid search**: Dense + BM25 sparse search via Qdrant Cloud with server-side embeddings
- **Dual storage**: Supabase Postgres (source of truth) + Qdrant Cloud (search)
- **MCP tools**: `teamind_store`, `teamind_search`, `teamind_context`, `teamind_lifecycle` — works with Claude Code, Codex, Cursor
- **Offline resilient**: Decisions queued locally when offline, synced on reconnect
- **Secure**: Per-member API keys (`tmm_` prefix), no service_role keys on client machines. 10 secret detection patterns block API keys/passwords before storage
- **Zero native deps**: Pure JS/TS, installs everywhere without node-gyp

## CLI Commands

| Command | Description |
|---------|-------------|
| `teamind init` | Create or join an organization |
| `teamind init --join <code>` | Join a project via invite code |
| `teamind serve` | Start MCP + Channel server (with realtime push) |
| `teamind status` | Show system health, realtime status, auth mode |
| `teamind dashboard` | Show team activity, lifecycle stats, dependency warnings |
| `teamind search <query>` | Search decisions (`--all` for suppressed, `--all-projects` for cross-project) |
| `teamind config set/get` | Manage configuration |
| `teamind switch --join <code>` | Switch to a different org |
| `teamind switch --project <name>` | Switch to a different project in current org |
| `teamind migrate-auth` | Migrate from org-level to per-member JWT auth |
| `teamind enrich` | Classify pending decisions via LLM (optional) |
| `teamind upgrade` | Upgrade plan via Stripe Checkout |
| `teamind admin metrics` | Platform-wide observability metrics |
| `teamind admin audit` | View audit trail for an org |
| `teamind admin cleanup` | Detect and clean duplicate/orphan decisions |
| `teamind admin patterns` | Detect decision patterns from clusters |
| `teamind admin migrate-qdrant` | Backfill project_id into Qdrant points |
| `teamind uninstall` | Clean removal |

## Phase 2 Features

- **Decision lifecycle**: Deprecate outdated decisions, promote proposed ones to active, supersede with replacements. Full status history via `teamind_lifecycle`.
- **Cross-session push**: Real-time notifications via Supabase Realtime when teammates store or deprecate decisions. Dedup suppresses echoes from the local session.
- **Per-member auth**: JWT-based authentication with per-member API keys (`tmm_` prefix). Migrate from org-level keys via `teamind migrate-auth`. Key rotation and revocation via Edge Functions.
- **Contradiction detection**: Two-tier detection (area overlap + Qdrant cosine similarity) flags conflicting active decisions on store. Contradictions auto-resolve when decisions are deprecated/superseded.
- **Platform metrics**: Operator dashboard with activation funnel, per-org COGS, churn/at-risk tracking, and active member counts via `teamind admin metrics`.
- **Audit trail**: Full audit log of decision stores, status changes, key rotations, and member events via `teamind admin audit`.
- **Registration API**: Public endpoint creates org + project + member atomically. No credentials needed for hosted mode onboarding.

## How It Works

1. **Init**: Registers with Teamind hosted (or self-hosted Supabase), configures your IDE's MCP server, seeds initial decisions from CLAUDE.md and git history
2. **Capture**: Your AI agent calls `teamind_store` when decisions are made. Activity watcher sends reminders. Session-end hooks catch what was missed.
3. **Search**: `teamind_search` and `teamind_context` query the team brain via hybrid search. Results ranked by relevance.
4. **Push**: New decisions push notifications to active team sessions via channels.

## Architecture

```
Agent <-> MCP (stdio) <-> Teamind CLI <-> Vercel API Routes / Supabase Postgres + Qdrant Cloud
```

- **CLI package**: TypeScript, commander, @modelcontextprotocol/sdk
- **Web package**: Next.js on Vercel — API routes (`/api/*`) replace Supabase Edge Functions for hosted mode
- **Storage**: Supabase (Postgres) + Qdrant Cloud (search)
- **API**: Hosted mode routes through Vercel API routes (`https://teamind.krukit.co/api/*`). Community/self-hosted mode continues using Supabase Edge Functions (`/functions/v1/*`).
- **Auth**: Per-member API keys via registration API, JWT tokens via exchange-token
- **Transport**: stdio (MCP standard)

## Development

```bash
git clone git@github.com:Todmy/teamind.git
cd teamind
pnpm install
pnpm build
pnpm test
```

## License

Apache 2.0
