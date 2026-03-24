# Edge Function Contracts: Registration API

Extends `/specs/004-multi-project/contracts/edge-functions.md`.

## POST /functions/v1/register (new)

Public endpoint. Creates an org, default project, and first member
atomically. No authentication required.

**Request** (no Bearer token):

```json
{
  "org_name": "My Org",
  "project_name": "frontend-app",
  "author_name": "Alice"
}
```

**Response (201)**:

```json
{
  "member_api_key": "tmm_...",
  "supabase_url": "https://xyz.supabase.co",
  "qdrant_url": "https://xyz.qdrant.io",
  "org_id": "uuid",
  "org_name": "My Org",
  "project_id": "uuid",
  "project_name": "frontend-app",
  "invite_code": "ABCD-1234"
}
```

**Errors**:
- 400: `{ "error": "org_name_required" }` — name missing or empty
- 400: `{ "error": "project_name_required" }` — project name missing or empty
- 400: `{ "error": "author_name_required" }` — author name missing or empty
- 400: `{ "error": "invalid_name", "field": "org_name" }` — name fails validation (1-100 chars, alphanumeric + spaces + hyphens)
- 400: `{ "error": "invalid_name", "field": "project_name" }` — same validation
- 409: `{ "error": "org_name_taken" }` — org name already exists
- 429: `{ "error": "rate_limit_exceeded" }` — more than 10 registrations from this IP in the last hour
- 500: `{ "error": "registration_failed" }`

**Logic**:
1. Validate inputs: `org_name` (1-100 chars, trimmed), `project_name` (1-100 chars, trimmed), `author_name` (1-100 chars, trimmed)
2. Extract client IP from request headers (`x-forwarded-for` or `x-real-ip`)
3. Rate limit check: `SELECT count(*) FROM registration_rate_limits WHERE ip_address = $ip AND created_at > now() - interval '1 hour'`. If >= 10, return 429
4. Check org name uniqueness: `SELECT id FROM orgs WHERE name ILIKE $org_name`. If exists, return 409
5. Generate org API key (`tm_` prefix), org invite code, member API key (`tmm_` prefix), project invite code
6. INSERT into `orgs` (id, name, api_key, invite_code)
7. INSERT into `members` (org_id, author_name, role='admin', api_key=tmm_...)
8. INSERT into `projects` (org_id, name, invite_code)
9. INSERT into `project_members` (project_id, member_id, role='project_admin')
10. INSERT audit entries: `org_created`, `member_joined`, `project_created`
11. INSERT into `registration_rate_limits` (ip_address)
12. Read `SUPABASE_URL` and `QDRANT_URL` from Deno env (public endpoint addresses)
13. Return response with member_api_key + public URLs + IDs

**Rollback**: On failure at any step, delete all preceding inserts in reverse order (project_members, projects, members, orgs). Manual rollback — no DB transaction available in Edge Functions.

**Security**:
- No service_role key, org API key, or Qdrant API key in response
- The `supabase_url` and `qdrant_url` are public endpoint addresses (not secrets)
- Per-member API key (`tmm_`) is the only credential returned
- Rate limiting prevents abuse of the public endpoint

**Name validation regex**: `/^[a-zA-Z0-9][a-zA-Z0-9 \-]{0,98}[a-zA-Z0-9]$/` (or single char `[a-zA-Z0-9]`). Allows alphanumeric, spaces, and hyphens. Must start and end with alphanumeric.

---

## POST /functions/v1/join-project (modified)

Changes from Phase 4 contract: add `supabase_url` and `qdrant_url` to
the response so the CLI does not need to know them in advance.

**Request** (unchanged — no Bearer token required):

```json
{
  "invite_code": "ABCD-1234",
  "author_name": "Bob"
}
```

**Updated Response (200)**:

```json
{
  "org_id": "uuid",
  "org_name": "My Org",
  "project_id": "uuid",
  "project_name": "frontend-app",
  "api_key": "tm_...",
  "member_api_key": "tmm_...",
  "member_id": "uuid",
  "supabase_url": "https://xyz.supabase.co",
  "qdrant_url": "https://xyz.qdrant.io",
  "member_count": 5,
  "decision_count": 42,
  "role": "project_member"
}
```

**Changes from Phase 4 response**:
- **Added**: `supabase_url` (public Supabase endpoint)
- **Added**: `qdrant_url` (public Qdrant endpoint)
- **Added**: `member_id` (for CLI config storage)
- **Renamed**: `member_key` -> `member_api_key` (consistent with register endpoint)

**Errors** (unchanged from Phase 4):
- 400: `{ "error": "invite_code_required" }`
- 400: `{ "error": "author_name_required" }`
- 403: `{ "error": "member_limit_reached" }` — org member limit for plan
- 404: `{ "error": "invalid_invite_code" }` — no project found
- 409: `{ "error": "already_project_member" }` — already in this project
- 500: `{ "error": "join_failed" }`

**Updated Logic** (additions to Phase 4):
1. (existing) Look up project by invite code
2. (existing) Create org member if needed, add to project_members
3. **NEW**: Read `SUPABASE_URL` and `QDRANT_URL` from Deno env
4. **NEW**: Include `supabase_url`, `qdrant_url`, `member_id` in response
5. **NEW**: Return `member_api_key` instead of `member_key` (rename only)

**Backward compatibility**: Existing callers that ignore unknown fields
are unaffected. The `member_key` field is renamed to `member_api_key` —
the CLI is updated in the same release. No external consumers depend on
the old field name.

---

## Edge Function Summary

| Endpoint | Status | Changes |
|----------|--------|---------|
| `register` | **NEW** | Public registration: create org + project + member atomically |
| `join-project` | **MODIFIED** | Add supabase_url, qdrant_url, member_id to response |
| `create-org` | UNCHANGED | Still used internally (not called by CLI in hosted mode) |
| `create-project` | UNCHANGED | Still used for creating additional projects |
| `exchange-token` | UNCHANGED | Accepts tmm_ keys as before |
| `join-org` | DEPRECATED | Already deprecated in Phase 4 |
