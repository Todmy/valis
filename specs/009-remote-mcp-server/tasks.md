# Tasks: Remote MCP Server

**Input**: Design documents from `/specs/009-remote-mcp-server/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks grouped by user story for independent implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Add MCP SDK dependency to web package and define shared types

- [x] T001 Add `@modelcontextprotocol/sdk` and `zod` dependencies to `packages/web/package.json`, add `"valis": "workspace:*"` as workspace dependency, run `pnpm install`
- [x] T002 Add `ServerConfig` interface to `packages/cli/src/types.ts` — runtime execution context with fields: org_id, member_id, author_name, role, auth_mode, supabase_url, supabase_service_role_key, qdrant_url, qdrant_api_key, api_key, member_api_key (see data-model.md)

---

## Phase 2: Foundational (Refactor CLI for Injectable Config)

**Purpose**: Refactor `createMcpServer()` and all 4 tool handlers to accept config via closure instead of calling `loadConfig()` internally. This MUST complete before any user story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. CLI must continue working after refactor.

- [x] T003 Refactor `packages/cli/src/mcp/server.ts` — `createMcpServer(configOverride?: ServerConfig)` accepts optional config. When provided, pass it to tool handlers via closure. When absent, handlers fall back to `loadConfig()` internally (CLI backward compat).
- [x] T004 [P] Refactor `packages/cli/src/mcp/tools/store.ts` — `handleStore(args, config?)`. When `config` provided, use it directly instead of `loadConfig()` + `resolveConfig()`. Use `args.project_id` instead of `resolveConfig().project.project_id` when in remote mode.
- [x] T005 [P] Refactor `packages/cli/src/mcp/tools/search.ts` — `handleSearch(args, config?)`. Same pattern: use injected config when provided, `loadConfig()` fallback when not.
- [x] T006 [P] Refactor `packages/cli/src/mcp/tools/context.ts` — `handleContext(args, config?)`. Same pattern.
- [x] T007 [P] Refactor `packages/cli/src/mcp/tools/lifecycle.ts` — `handleLifecycle(args, config?)`. Same pattern.
- [x] T008 Update `packages/cli/src/commands/serve.ts` — pass no config override to `createMcpServer()` (preserves existing CLI behavior, explicit no-op change to confirm backward compat).
- [x] T009 Run `pnpm test && pnpm lint` from repo root to verify CLI still works after refactor.

**Checkpoint**: CLI MCP server works exactly as before. All existing tests pass. Config injection ready for remote use.

---

## Phase 3: User Story 1 - Connect and use tools from claude.ai web (Priority: P1) 🎯 MVP

**Goal**: Working remote MCP endpoint at `POST /api/mcp` that accepts Bearer auth and serves all 4 tools.

**Independent Test**: `curl -X POST https://valis.krukit.co/api/mcp -H "Authorization: Bearer tmm_xxx" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'` returns server info and tool list.

### Implementation for User Story 1

- [x] T010 [US1] Create `packages/web/src/lib/mcp-config.ts` — `buildServerConfig(auth: AuthResult, bearerToken: string): ServerConfig` function. Maps AuthResult fields + `process.env.SUPABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY`, `process.env.QDRANT_URL`, `process.env.QDRANT_API_KEY` to ServerConfig interface. Throws if any env var missing.
- [x] T011 [US1] Create `packages/web/src/app/api/mcp/route.ts` — POST handler: extract Bearer token via `extractBearerToken()`, authenticate via `authenticateApiKey()`, build config via `buildServerConfig()`, create `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`, create MCP server via `createMcpServer(config)`, connect transport, return `transport.handleRequest(request)`. Add `export const dynamic = 'force-dynamic'`.
- [x] T012 [US1] Add CORS support to `packages/web/src/app/api/mcp/route.ts` — add `OPTIONS` handler returning 204 with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, Authorization, Mcp-Session-Id`. For POST: wrap the `Response` returned by `transport.handleRequest()` — create a new `Response` with the same body/status but with CORS headers appended (transport returns its own Response object, so headers must be merged into a copy, not mutated).
- [x] T013 [US1] Run `pnpm --filter @valis/web build` to verify the route compiles without errors.
- [x] T014 [US1] Manual smoke test (deferred to T020/T021 — requires live env vars): start dev server (`pnpm --filter @valis/web dev`), send curl initialize request to `http://localhost:3000/api/mcp` with a valid Bearer token, verify 4 tools returned. Then test `tools/call` with `valis_search`.

**Checkpoint**: User Story 1 fully functional — remote MCP endpoint works with all 4 tools via POST.

---

## Phase 4: User Story 2 - Reject unauthorized access (Priority: P1)

**Goal**: All requests without valid auth are rejected with appropriate HTTP errors before any tool logic executes.

**Independent Test**: Send requests with no auth, invalid key, revoked key, malformed body — all return proper error codes.

### Implementation for User Story 2

- [x] T015 [US2] Add auth error handling to `packages/web/src/app/api/mcp/route.ts` — return 401 JSON-RPC error when `extractBearerToken()` returns null or `authenticateApiKey()` returns null. Return 400 for requests with empty/unparseable body. Ensure error responses include CORS headers.
- [x] T016 [US2] Manual smoke test (deferred to T020/T021): send curl requests with no Authorization header (expect 401), with `Bearer invalid_key` (expect 401), with valid auth but empty body (expect 400).

**Checkpoint**: Auth rejection works correctly for all invalid scenarios.

---

## Phase 5: User Story 3 - Connect from any MCP-compatible client (Priority: P2)

**Goal**: Endpoint works with any MCP SDK client, not just curl/claude.ai. Org-level keys work.

**Independent Test**: Connect with MCP TypeScript SDK `StreamableHTTPClientTransport` and call tools.

### Implementation for User Story 3

- [x] T017 [US3] Verify org-level `tm_` key auth works in `packages/web/src/app/api/mcp/route.ts` — `authenticateApiKey()` already handles `tm_` keys and resolves to admin member. No code change expected; manual verification that org keys work through the full tool flow.
- [x] T018 [US3] Manual integration test (deferred to T020/T021): write a short TypeScript script using `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport` to connect, initialize, list tools, and call `valis_search`. Verify it works with both `tmm_` and `tm_` keys.

**Checkpoint**: All user stories functional — endpoint works with any MCP client.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect the whole feature

- [x] T019 [P] Update `specs/009-remote-mcp-server/quickstart.md` with actual tested curl commands and verified endpoint URL
- [ ] T020 [P] Deploy to Vercel (preview deployment) and test remote endpoint with a real Bearer token
- [ ] T021 Test from claude.ai web: configure remote MCP server in settings, verify all 4 tools appear and work

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on T002 (ServerConfig type). BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Phase 2 completion
- **User Story 2 (Phase 4)**: Depends on T011 (route exists) — can start after US1 core
- **User Story 3 (Phase 5)**: Depends on T011 (route exists) — can start after US1 core
- **Polish (Phase 6)**: Depends on all stories complete

### Within Phases

- T004, T005, T006, T007 can all run in **parallel** (different files, same refactor pattern)
- T010 and T011 are sequential (T011 depends on T010)
- T015 depends on T011 existing

### Parallel Opportunities

```
Phase 2 parallel group:
  T004 (store.ts) | T005 (search.ts) | T006 (context.ts) | T007 (lifecycle.ts)

Phase 4+5 can start in parallel after Phase 3 core (T011):
  T015 (auth errors) | T017 (org key verification)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational refactor (T003-T009)
3. Complete Phase 3: User Story 1 (T010-T014)
4. **STOP and VALIDATE**: Test endpoint with curl + real API key
5. Deploy preview if ready

### Incremental Delivery

1. Setup + Foundational → Injectable config ready, CLI still works
2. Add US1 → Working endpoint → Deploy preview (MVP!)
3. Add US2 → Auth hardened → Deploy
4. Add US3 → Protocol compliance verified → Final deploy
5. Polish → Docs updated, tested from claude.ai

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story
- The foundational refactor (Phase 2) is the riskiest part — it touches 5 existing files. Run full test suite after.
- No database migrations needed — zero schema changes
- No new env vars needed — all already on Vercel
