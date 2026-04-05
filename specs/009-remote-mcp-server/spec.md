# Feature Specification: Remote MCP Server

**Feature Branch**: `009-remote-mcp-server`  
**Created**: 2026-04-01  
**Status**: Draft  
**Input**: User description: "Remote MCP Server — add Streamable HTTP MCP endpoint at POST /api/mcp in packages/web (Vercel). Stateless, auth via existing Bearer API keys, uses WebStandardStreamableHTTPServerTransport. Reuses createMcpServer() with injectable config."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect and use tools from claude.ai web (Priority: P1)

A user who already has a Valis account and API key wants to use Valis decision tools from claude.ai web interface. They configure a remote MCP server in claude.ai settings by providing the endpoint URL and their API key as a Bearer token. After connecting, they can store decisions, search the team brain, load context, and manage decision lifecycle — the same 4 tools available in the CLI.

**Why this priority**: This is the core value — making Valis accessible from clients that cannot run local processes. Without this, Valis is limited to CLI-capable environments only.

**Independent Test**: Can be fully tested by configuring claude.ai MCP settings with the endpoint URL and a valid API key, then calling each of the 4 tools. Delivers value immediately — user can interact with their team's decision history from a web browser.

**Acceptance Scenarios**:

1. **Given** a user with a valid per-member API key, **When** they configure the remote MCP endpoint in claude.ai with Bearer auth, **Then** the connection succeeds and 4 tools (valis_store, valis_search, valis_context, valis_lifecycle) are listed.
2. **Given** a connected user, **When** they call valis_store with decision text and a project_id, **Then** the decision is persisted to the database and vector store, and a confirmation with the decision ID is returned.
3. **Given** a connected user, **When** they call valis_search with a query, **Then** relevant decisions from their organization are returned with scores, types, and status labels.
4. **Given** a connected user, **When** they call valis_context with a task description, **Then** grouped decisions (decisions, constraints, patterns, lessons) relevant to that task are returned.

---

### User Story 2 - Reject unauthorized access (Priority: P1)

A user or automated agent sends a request to the MCP endpoint without a valid API key. The system rejects the request clearly, without leaking information about valid keys or internal structure.

**Why this priority**: Security is non-negotiable for a public endpoint. Invalid auth must be handled correctly from day one.

**Independent Test**: Can be tested by sending requests with no auth header, an empty Bearer token, a revoked key, and a malformed key. Each should return an appropriate error response.

**Acceptance Scenarios**:

1. **Given** a request with no Authorization header, **When** the endpoint receives it, **Then** it returns a 401 error response.
2. **Given** a request with a revoked per-member key, **When** the endpoint receives it, **Then** it returns a 401 error response.
3. **Given** a request with a valid key but malformed request body, **When** the endpoint receives it, **Then** it returns a 400 error with a descriptive message.

---

### User Story 3 - Connect from any MCP-compatible client (Priority: P2)

A developer using any MCP-compatible client (Cursor, custom integrations, third-party AI agents) wants to connect to Valis remotely. They use the standard Streamable HTTP transport protocol with Bearer authentication. The endpoint behaves identically regardless of which client connects.

**Why this priority**: Expands Valis reach beyond claude.ai to the broader MCP ecosystem. Lower priority because claude.ai is the immediate use case, but the endpoint is protocol-compliant by design.

**Independent Test**: Can be tested by connecting with any MCP SDK client pointing to the endpoint with a Bearer token, then listing and invoking tools programmatically.

**Acceptance Scenarios**:

1. **Given** a developer using any MCP client library, **When** they connect to the endpoint with a valid Bearer token, **Then** they can initialize, list tools, and invoke any of the 4 tools.
2. **Given** an org-level API key, **When** used for Bearer auth, **Then** tools execute in the context of the org's admin member, consistent with existing API behavior.

---

### Edge Cases

- What happens when the user's organization has exceeded its free tier usage limit? The existing billing check in tool handlers returns a usage_limit_reached error — same behavior as CLI mode.
- What happens when the vector store is temporarily unavailable? Store operations succeed (relational database is source of truth), search/context operations return an empty/offline result — same degraded behavior as CLI mode.
- What happens when a tool call includes a project_id the user doesn't have access to? The existing access control policies and project membership checks reject the operation.
- What happens when the request body is not valid JSON-RPC? The MCP transport layer returns a standard JSON-RPC parse error before any tool logic executes.
- What happens when concurrent requests arrive with the same API key? Each request is fully stateless and independent — no shared state, no race conditions.

## Clarifications

### Session 2026-04-01

- Q: CORS policy for cross-origin MCP requests from browser-based clients? → A: Allow all origins (`*`) — wildcard CORS headers, auth handled via Bearer token.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose a single HTTP endpoint that accepts POST requests conforming to the MCP Streamable HTTP transport specification.
- **FR-002**: System MUST authenticate every request using Bearer tokens with existing API key formats (per-member keys and org-level keys).
- **FR-003**: System MUST respond to the MCP initialize request with server info and the list of 4 available tools (valis_store, valis_search, valis_context, valis_lifecycle).
- **FR-004**: System MUST execute tool calls using the same business logic as the CLI MCP server, producing identical results for identical inputs and data state.
- **FR-005**: System MUST operate statelessly — each HTTP request is independent, no server-side sessions are maintained between requests.
- **FR-006**: System MUST derive execution context (organization, member identity, permissions) from the authenticated API key, not from filesystem configuration.
- **FR-007**: System MUST resolve infrastructure credentials (database connection details, vector store credentials) from server-side environment variables.
- **FR-008**: System MUST return appropriate HTTP error responses for authentication failures (401), malformed requests (400), and internal errors (500).
- **FR-009**: System MUST include wildcard CORS headers (`Access-Control-Allow-Origin: *`) to permit cross-origin requests from browser-based MCP clients.

### Key Entities

- **Server Configuration**: Execution context combining identity information (from authentication) and infrastructure credentials (from environment). Replaces the filesystem-based configuration used in CLI mode.
- **MCP Transport Adapter**: The Streamable HTTP adapter that bridges HTTP POST requests to JSON-RPC message handling within the MCP server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can connect to the remote MCP endpoint from claude.ai web and successfully call all 4 tools within 60 seconds of initial configuration.
- **SC-002**: Tool call responses return within 2 seconds for search/context operations and within 3 seconds for store operations under normal conditions.
- **SC-003**: 100% of requests without valid authentication are rejected before any tool logic executes.
- **SC-004**: Tool outputs from the remote endpoint are functionally equivalent to CLI MCP tool outputs given the same inputs and data state.

## Assumptions

- The MCP SDK package already in CLI dependencies includes a Web Standard-compatible HTTP transport suitable for serverless environments.
- The environment variables needed for database and vector store access are already configured on the hosting platform for existing API routes.
- OAuth 2.1 is explicitly out of scope. Authentication uses static API keys only.
- SSE streaming (GET requests) and session management (DELETE requests) are out of scope.
- Existing billing/usage checks and free tier limits apply identically to remote MCP calls.
- CLI MCP server continues to use its existing stdio transport — this feature adds a parallel access path, not a replacement.

## Out of Scope

- OAuth 2.1 authentication flow
- SSE server push notifications
- Session management
- Stateful features: file watching, hook handling, offline queue, realtime subscriptions
- Per-endpoint rate limiting beyond existing billing checks
