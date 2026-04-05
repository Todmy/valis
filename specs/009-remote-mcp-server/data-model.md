# Data Model: Remote MCP Server

## New Entities

### ServerConfig

Runtime execution context for remote MCP tool handlers. Replaces filesystem-based `ValisConfig` + `ResolvedConfig`.

| Field | Type | Source | Description |
|---|---|---|---|
| org_id | string (UUID) | AuthResult | Organization ID from API key lookup |
| member_id | string (UUID) | AuthResult | Member ID from API key lookup |
| author_name | string | AuthResult | Display name for audit trail |
| role | string | AuthResult | Member role (admin/member) |
| auth_mode | 'jwt' (literal) | Hardcoded | Always JWT mode for remote |
| supabase_url | string (URL) | process.env.SUPABASE_URL | Supabase project URL |
| supabase_service_role_key | string | process.env.SUPABASE_SERVICE_ROLE_KEY | Service role key for DB operations |
| qdrant_url | string (URL) | process.env.QDRANT_URL | Qdrant cluster URL |
| qdrant_api_key | string | process.env.QDRANT_API_KEY | Qdrant API key |
| api_key | string | AuthResult (bearer token) | The API key used for auth (same as member_api_key) |
| member_api_key | string | AuthResult (bearer token) | Per-member API key for JWT exchange |

**Relationships**: ServerConfig is a superset of the fields tool handlers read from `ValisConfig`. It is constructed per-request and discarded after the response.

**Validation**: All fields required. Construction fails fast if any env var is missing.

## Existing Entities (unchanged)

No database schema changes. No new tables or columns. The remote endpoint operates on the same data as CLI:

- `decisions` — stored/searched via existing handlers
- `members` — looked up during API key auth
- `orgs` — looked up for org-level keys
- `audit_entries` — written by lifecycle/store handlers
- `rate_limits` — checked by billing logic in handlers

## State Transitions

No new state transitions. The remote endpoint triggers the same decision lifecycle transitions as CLI (active, proposed, deprecated, superseded).
