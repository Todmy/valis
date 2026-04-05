# Implementation Plan: Remote MCP Server

**Branch**: `009-remote-mcp-server` | **Date**: 2026-04-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-remote-mcp-server/spec.md`

## Summary

Add a public Streamable HTTP MCP endpoint at `POST /api/mcp` in `packages/web` (Vercel). The endpoint reuses the existing 4 MCP tools (store, search, context, lifecycle) from `packages/cli` with an injectable config pattern — replacing filesystem-based `loadConfig()` with a server config built from Bearer token auth + environment variables. Stateless, no sessions, wildcard CORS.

## Technical Context

**Language/Version**: TypeScript (ES2022, NodeNext), Node.js 20+
**Primary Dependencies**: `@modelcontextprotocol/sdk` 1.27.1 (existing — `WebStandardStreamableHTTPServerTransport`), `@supabase/supabase-js` (existing), `@qdrant/js-client-rest` (existing)
**Storage**: Supabase Postgres (source of truth) + Qdrant Cloud (search layer) — both existing
**Testing**: vitest (existing in both packages)
**Target Platform**: Vercel Serverless Functions (Node.js runtime)
**Project Type**: web-service (additional endpoint in existing Next.js app)
**Performance Goals**: <2s search/context, <3s store operations (per SC-002)
**Constraints**: Stateless per-request, no filesystem access, Vercel function timeout 60s default
**Scale/Scope**: Same usage limits as CLI (100 decisions/mo free tier, billing checks in handlers)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Cloud-First | PASS | Remote endpoint IS the cloud-first access path |
| II. Minimally Invasive | PASS | Standard MCP protocol over HTTP, no IDE interception |
| III. Non-Blocking | PASS | Endpoint failure doesn't affect CLI or IDE — separate access path |
| IV. No LLM Dependency | PASS | No LLM calls — same tool handlers as CLI |
| V. Zero Native Dependencies | PASS | No new dependencies added to CLI; web package uses existing deps |
| VI. Auto-Capture by Default | N/A | Remote endpoint is pull-based tools only; auto-capture stays in CLI |
| VII. Dual Storage | PASS | Same dual-write handlers (Postgres + Qdrant) |
| VIII. Push + Pull | PASS | Remote = pull-only for MVP; push stays in CLI (constitution says push is supplementary, never required) |
| IX. Decision Lifecycle | PASS | All 4 tools including lifecycle management exposed |
| X. Identity-First Access | PASS | Bearer token → per-member API key → AuthResult with memberId, orgId, role |
| XI. Project-Scoped Isolation | PASS | project_id passed as tool argument; search scoped by default |
| Security & Data Integrity | PASS | Secret detection in handlers, HTTPS enforced by Vercel, audit trail preserved |

No violations. Constitution gate passed.

## Project Structure

### Documentation (this feature)

```text
specs/009-remote-mcp-server/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
packages/
  cli/
    src/
      mcp/
        server.ts            # MODIFY: createMcpServer(config) accepts injectable config
        tools/
          store.ts           # MODIFY: receive config via closure, remove loadConfig()
          search.ts          # MODIFY: receive config via closure, remove loadConfig()
          context.ts         # MODIFY: receive config via closure, remove loadConfig()
          lifecycle.ts       # MODIFY: receive config via closure, remove loadConfig()
      types.ts               # MODIFY: add ServerConfig interface
  web/
    src/
      app/api/mcp/
        route.ts             # CREATE: POST handler with auth + transport
      lib/
        mcp-config.ts        # CREATE: buildServerConfig() from AuthResult + env
    package.json             # MODIFY: add @modelcontextprotocol/sdk dependency
```

**Structure Decision**: Extends existing monorepo structure. MCP server factory stays in `packages/cli` (shared between stdio and HTTP). HTTP route handler lives in `packages/web` alongside existing API routes. New `mcp-config.ts` utility in web's lib/ maps auth result to the config interface expected by tool handlers.

## Complexity Tracking

No constitution violations — table not needed.
