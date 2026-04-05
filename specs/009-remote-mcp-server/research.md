# Research: Remote MCP Server

## R1: WebStandardStreamableHTTPServerTransport + Next.js App Router

**Decision**: Use `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js` with stateless mode (`sessionIdGenerator: undefined`).

**Rationale**: This transport uses Web Standard `Request`/`Response` APIs — exactly what Next.js App Router route handlers use. No Express adapter needed. The transport's `handleRequest(req)` method accepts a standard `Request` and returns a standard `Response`.

**Alternatives considered**:
- `StreamableHTTPServerTransport` (Node.js/Express variant) — requires Express req/res objects, incompatible with Next.js App Router without adapters.
- `SSEServerTransport` — legacy, not recommended for new servers.

**Key findings from SDK docs** (v1.27.1):
```typescript
// Stateless mode — each request independent, no session tracking
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,  // stateless
  enableJsonResponse: true,       // JSON instead of SSE for simple request/response
});

// Usage: transport.handleRequest(request) → Promise<Response>
// Handles POST (tool calls), GET (SSE stream), DELETE (close session)
// For MVP: only POST needed
```

**CORS**: Transport does not handle CORS. Must add CORS headers in the Next.js route handler or via `OPTIONS` preflight handler.

## R2: Injectable Config Pattern for Tool Handlers

**Decision**: Refactor `createMcpServer()` to accept an optional config parameter. Tool handlers receive config via closure instead of calling `loadConfig()` internally.

**Rationale**: Minimal diff, backward-compatible. CLI path passes `loadConfig()` result. Remote path passes server-built config. Handlers don't need signature changes.

**Alternatives considered**:
- Pass config as extra argument to each handler — requires changing all 4 handler signatures and every call site.
- AsyncLocalStorage / context injection — overcomplicated for 4 functions.
- Separate `createRemoteMcpServer()` with duplicated tool registration — code duplication.

**Key design**:
```typescript
// types.ts — new interface
interface ServerConfig {
  org_id: string;
  member_id: string;
  author_name: string;
  role: string;
  auth_mode: 'jwt';
  supabase_url: string;
  supabase_service_role_key: string;
  qdrant_url: string;
  qdrant_api_key: string;
  member_api_key: string;
  // Fields from ValisConfig that handlers need but remote doesn't have:
  api_key: string;           // same as member_api_key for remote
  project_id?: string;       // from tool args, not filesystem
  project_name?: string;
}

// server.ts — modified factory
function createMcpServer(configOverride?: ServerConfig): McpServer {
  // Tool handlers use configOverride if provided, else loadConfig()
}
```

**What `resolveConfig()` does and how to replace it**:
- Reads `.valis.json` from cwd to get `project_id` and `project_name`
- In remote mode: `project_id` comes from tool call arguments (already in schema for store/search/context)
- In remote mode: `project_name` is optional, can be resolved from DB if needed

## R3: Auth Flow in Route Handler

**Decision**: Reuse existing `extractBearerToken()` + `authenticateApiKey()` from `packages/web/src/lib/api-auth.ts`. Same pattern as all other API routes.

**Rationale**: Proven, timing-safe, handles both `tmm_` and `tm_` key formats.

**Alternatives considered**:
- JWT verification via jose — would work but API keys are simpler and already what CLI users have.
- Custom auth middleware — unnecessary abstraction for one route.

**Key finding**: `authenticateApiKey()` returns `AuthResult { memberId, orgId, role, authorName }` — exactly the identity fields needed for ServerConfig.

## R4: CORS Handling in Next.js App Router

**Decision**: Add wildcard CORS headers via an `OPTIONS` handler and response headers on POST.

**Rationale**: Per clarification session — wildcard `*` origin, auth via Bearer token.

**Implementation pattern** (from Next.js docs):
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  // ... handle MCP request
  // Add corsHeaders to response
}
```

## R5: Dependency Installation

**Decision**: Add `@modelcontextprotocol/sdk` and `zod` to `packages/web/package.json`.

**Rationale**: The web package doesn't currently have the MCP SDK. Tool handlers import from `@modelcontextprotocol/sdk` and use `zod` for schema validation. These must be available at build time.

**Alternative considered**: Import tool handlers dynamically or restructure as a shared package — overcomplicated for 4 handlers.

**Note**: `@qdrant/js-client-rest` is NOT needed in web package — tool handlers import it from cli package's node_modules via the monorepo. Actually, since we're importing handler code from cli package, all cli dependencies need to be resolvable. Two options:
1. Add cli as a workspace dependency of web
2. Copy/adapt the necessary handler code into web

**Decision**: Add cli as a workspace dependency (`"valis": "workspace:*"` in web's package.json). This lets web import from cli directly without duplicating code.
