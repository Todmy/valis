# Research: Valis MVP

**Phase**: 0 — Outline & Research
**Date**: 2026-03-22
**Input**: Technical Context from plan.md, design-spec-v5.md, 5 design iterations

## Technology Decisions

### 1. Storage: Supabase Postgres + Qdrant Cloud (dual)

**Decision**: Use Supabase managed Postgres as source of truth and Qdrant
Cloud as hybrid search layer.

**Rationale**:
- Postgres provides ACID, PITR, SQL analytics, Row Level Security.
- Qdrant provides hybrid search (dense + BM25 sparse) out of the box
  with server-side embeddings (FastEmbed MiniLM 384d) — no local model.
- Dual storage is the industry standard for search-heavy apps.
- Supabase pro subscription already active (existing account).

**Alternatives rejected**:
- Qdrant-only: No ACID, weaker backup, no SQL for analytics.
- pgvector: No built-in hybrid search, worse quality at scale.
- Cloudflare D1: Immature, full vendor lock-in (rejected in spec v4→v5).
- SQLite local + Qdrant: Native dep (better-sqlite3), 15-25% install failures.

### 2. Cloud Backend: Supabase Edge Functions (not Cloudflare Workers)

**Decision**: Use Supabase Edge Functions for server-side logic (3 functions:
create-org, join-org, rotate-key). CLI talks to Supabase directly via
supabase-js for all other operations.

**Rationale**:
- Minimal Edge Functions (2-3 only) — CLI talks to Supabase directly for
  CRUD. Edge Functions only for operations requiring server-side logic
  (org creation with API key generation, invite code validation).
- Existing Supabase pro subscription, zero additional ops.
- Supabase-js client handles auth, RLS, and connection pooling.

**Alternatives rejected**:
- Full API layer in Edge Functions: Unnecessary abstraction for MVP.
- Cloudflare Workers + D1 + KV + Queues: Full vendor lock-in, D1 immature.
- Self-hosted Express/Hono: Ops overhead, deploy complexity.

### 3. Package Manager: pnpm workspace

**Decision**: pnpm workspace monorepo with single `cli` package. Supabase
functions in `supabase/` at root (standard Supabase CLI convention).

**Rationale**:
- pnpm is fastest, strictest (no phantom deps), workspace support.
- Single package for MVP simplifies build, publish, and install.
- Monorepo allows adding `dashboard` or `sdk` packages later.

**Alternatives rejected**:
- npm/yarn: Slower, phantom dep risk.
- Turborepo: Overkill for single package MVP.
- Multi-package (cli + cloud): Unnecessary — Edge Functions deploy via
  Supabase CLI, not npm.

### 4. MCP SDK: @modelcontextprotocol/sdk

**Decision**: Use official MCP SDK for server implementation with stdio
transport and experimental channel capability.

**Rationale**:
- Official SDK, maintained by Anthropic.
- Stdio transport is the standard for local MCP servers.
- Channel support via `experimental: { 'claude/channel': {} }` in capabilities.
- TypeScript-native, zod schema validation for tool inputs.

**No alternatives considered** — this is the only maintained MCP SDK for TS.

### 5. CLI Framework: commander

**Decision**: Use commander for CLI argument parsing.

**Rationale**:
- Most popular Node.js CLI framework, zero native deps.
- Subcommand support, auto-generated help, TypeScript types.
- Used by Vercel CLI, Prisma, and thousands of other tools.

**Alternatives rejected**:
- yargs: Heavier, more complex API.
- oclif: Overkill for 8 commands.
- citty/unbuild: Less mature, smaller ecosystem.

### 6. File Watching: chokidar

**Decision**: Use chokidar for monitoring `~/.claude/projects/` JSONL files.

**Rationale**:
- Most reliable cross-platform file watcher for Node.js.
- Handles macOS FSEvents, Linux inotify.
- `awaitWriteFinish` option prevents reading partial writes.

**Alternatives considered**:
- Native `fs.watch` with `recursive: true`: Node 19+ only, less reliable
  on macOS. Fallback option if chokidar causes issues.

### 7. Vector Embedding: Server-side (Qdrant FastEmbed)

**Decision**: Use Qdrant Cloud server-side embeddings. No local embedding
model.

**Rationale**:
- Qdrant Cloud generates both dense (MiniLM 384d) and sparse (BM25) vectors
  server-side from raw text.
- Zero local computation, zero model download, zero native deps.
- 384d vectors = 4× more capacity than 1536d alternatives.

**Alternatives rejected**:
- Local embedding model: Native dep, download size, CPU overhead.
- OpenAI embeddings: API key dependency, cost, latency.

### 8. Testing: vitest

**Decision**: Use vitest for unit and integration testing.

**Rationale**:
- Native ESM support, TypeScript-first, fast HMR in watch mode.
- Compatible with Node.js test patterns.
- Mock support for Supabase/Qdrant clients.

**Alternatives rejected**:
- Jest: Slower ESM support, heavier config.
- Node test runner: Less mature mocking, no watch mode.

### 9. Installation: npm install -g (not npx)

**Decision**: Global install via `npm install -g valis`.

**Rationale**:
- npx cold start = 3-10s blocking on every MCP server launch.
- Global install = ~200ms startup. Critical for MCP server responsiveness.
- IDE launches MCP server as subprocess — startup time matters.

**Alternatives rejected**:
- npx: 3-10s cold start, registry dependency on every launch.

### 10. License: Apache 2.0

**Decision**: Apache 2.0 for open source core.

**Rationale**:
- Developer community trust. No friction with early adopters.
- Monetize cloud (hosted storage, team sync, dashboard), not license.
- Permissive enough for enterprise adoption.

**Alternatives rejected**:
- BSL 1.1: Scares contributors, friction with developers.
- MIT: No patent protection.
- AGPL: Too restrictive for enterprise adoption.

## All NEEDS CLARIFICATION: Resolved

No unresolved items. All technology decisions were made during 5 design
spec iterations (v1→v5) and validated against the constitution.
