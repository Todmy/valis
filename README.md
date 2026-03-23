# Teamind

Shared decision intelligence for AI-augmented engineering teams.

Teamind captures, stores, searches, and pushes team decisions across developer sessions. Your AI coding agent remembers what the team decided — so nobody asks "why did we choose PostgreSQL?" twice.

## Install

```bash
npm install -g teamind
```

**Prerequisites**: Node.js 20+, Supabase account, Qdrant Cloud account.

## Quickstart (30 seconds)

```bash
# 1. Create your team's brain
teamind init

# 2. Share the invite code with teammates
teamind init --join ACME-7X3K

# 3. Your IDE's AI agent now has team memory
# teamind_store, teamind_search, teamind_context — all automatic
```

## Features

- **Auto-capture**: Decisions captured automatically through channel reminders, keyword triggers, and session sweep
- **Hybrid search**: Dense + BM25 sparse search via Qdrant Cloud with server-side embeddings
- **Dual storage**: Supabase Postgres (source of truth) + Qdrant Cloud (search)
- **MCP tools**: `teamind_store`, `teamind_search`, `teamind_context` — works with Claude Code, Codex
- **Offline resilient**: Decisions queued locally when offline, synced on reconnect
- **Secure**: 10 secret detection patterns block API keys/passwords before storage
- **Zero native deps**: Pure JS/TS, installs everywhere without node-gyp

## CLI Commands

| Command | Description |
|---------|-------------|
| `teamind init` | Create or join an organization |
| `teamind serve` | Start MCP + Channel server |
| `teamind status` | Show system health |
| `teamind dashboard` | Show team activity |
| `teamind search <query>` | Search decisions |
| `teamind export --json` | Export all decisions |
| `teamind config set/get` | Manage configuration |
| `teamind uninstall` | Clean removal |

## How It Works

1. **Init**: Creates org in Supabase, configures your IDE's MCP server, seeds initial decisions from CLAUDE.md and git history
2. **Capture**: Your AI agent calls `teamind_store` when decisions are made. Activity watcher sends reminders. Session-end hooks catch what was missed.
3. **Search**: `teamind_search` and `teamind_context` query the team brain via hybrid search. Results ranked by relevance.
4. **Push**: New decisions push notifications to active team sessions via channels.

## Architecture

```
Agent <-> MCP (stdio) <-> Teamind CLI <-> Supabase Postgres + Qdrant Cloud
```

- **CLI package**: TypeScript, commander, @modelcontextprotocol/sdk
- **Storage**: Supabase (Postgres + Edge Functions) + Qdrant Cloud
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
