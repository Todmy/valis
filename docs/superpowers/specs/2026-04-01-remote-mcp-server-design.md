# Remote MCP Server — Design Spec

**Date:** 2026-04-01
**Status:** Approved

## Problem

Valis MCP server uses stdio transport — works only with clients that can spawn local processes (Claude Code, Cursor). Clients like claude.ai web, mobile apps, and third-party agents cannot use stdio and need a remote HTTP endpoint.

## Decision

Add a Streamable HTTP MCP endpoint at `POST /api/mcp` inside the existing `packages/web` Next.js app on Vercel.

### Parameters (from brainstorming)

| Parameter | Choice | Reasoning |
|---|---|---|
| Target clients | Any remote MCP client (claude.ai, IDEs, external agents) | Public API, not just personal use |
| Hosting | Existing Vercel project (`packages/web`) | Auth, deploy pipeline, domain already exist |
| Auth | Bearer token with existing API keys (`tmm_`/`tm_`) | Zero new auth work; OAuth 2.1 later |
| Transport | Streamable HTTP (POST only for MVP) | Current MCP standard; GET SSE and DELETE later |

## Architecture

### Request Flow

```
Client → POST /api/mcp (Bearer: tmm_xxx)
  → extractBearerToken() + authenticateApiKey()   [existing api-auth.ts]
  → build ServerConfig from AuthResult + process.env
  → createRemoteMcpServer(config)                 [new: server-remote.ts]
  → StreamableHTTPServerTransport handles JSON-RPC
  → tool handler executes with injected config
  → JSON-RPC response
```

### Injectable Config (closure pattern)

Current tool handlers call `loadConfig()` (filesystem) and `resolveConfig()` (cwd). Remote mode replaces these with a config object built from:

1. **Auth result** (per-request): `orgId`, `memberId`, `authorName`, `role`
2. **Env vars** (server-side): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`

Config is injected via closure in `createRemoteMcpServer(config)` — tool handlers receive it implicitly, no signature changes needed.

`project_id` comes from the client as a tool argument (already in schema), replacing filesystem-based `resolveConfig()`.

### Local vs Remote Comparison

| Aspect | Claude Code (stdio) | Remote (HTTP) |
|---|---|---|
| Config source | `~/.valis/config.json` | env vars + Bearer token |
| Project resolution | `.valis.json` from cwd | `project_id` tool argument |
| Offline fallback | Yes (local queue) | No |
| Realtime push | Yes (WebSocket) | No (MVP) |
| File watcher | Yes | No |
| Latency | ~1ms | ~100-300ms |

### What's Excluded from Remote

Stateful features that don't work in serverless:

- File watcher (`startWatcher`) — no filesystem to monitor
- Hook handler (`startHookHandler`) — Claude Code specific
- Startup sweep (`startupSweep`) — no offline queue
- Realtime subscription (`subscribe`) — long-lived WebSocket incompatible with serverless
- Offline fallback (`appendToQueue`) — no local disk

### Not in MVP

- OAuth 2.1 flow (API keys sufficient for launch)
- GET `/api/mcp` SSE stream (server push notifications)
- Per-endpoint rate limiting (billing checks in handlers + Vercel-level limits sufficient)

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `packages/web/src/app/api/mcp/route.ts` | **Create** | POST handler: auth + Streamable HTTP transport |
| `packages/cli/src/mcp/server.ts` | **Refactor** | `createMcpServer(config)` accepts config parameter |
| `packages/cli/src/mcp/tools/store.ts` | **Refactor** | Remove `loadConfig()`/`resolveConfig()`, use config from closure |
| `packages/cli/src/mcp/tools/search.ts` | **Refactor** | Same — config from closure |
| `packages/cli/src/mcp/tools/context.ts` | **Refactor** | Same — config from closure |
| `packages/cli/src/mcp/tools/lifecycle.ts` | **Refactor** | Same — config from closure |
| `packages/cli/src/commands/serve.ts` | **Modify** | Pass `loadConfig()` result to `createMcpServer()` |

**New dependencies:** None. MCP SDK and api-auth already available.

## Endpoint

Production: `https://valis.krukit.co/api/mcp`

Usage in claude.ai MCP settings:
```
URL: https://valis.krukit.co/api/mcp
Auth: Bearer tmm_your_api_key_here
```
