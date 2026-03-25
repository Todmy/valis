# Edge Function Contracts: Phase 4

Extends `/specs/002-retention-enterprise/contracts/edge-functions.md`.

## POST /functions/v1/create-project (new)

Create a new project within an existing organization.

**Request** (authenticated via Bearer token — API key):

```json
{
  "org_id": "uuid",
  "project_name": "frontend-app"
}
```

**Response (201)**:

```json
{
  "project_id": "uuid",
  "org_id": "uuid",
  "project_name": "frontend-app",
  "invite_code": "ABCD-1234",
  "role": "project_admin"
}
```

**Errors**:
- 400: `{ "error": "project_name_required" }` — name missing or empty
- 400: `{ "error": "project_name_too_long" }` — name exceeds 100 chars
- 401: `{ "error": "unauthorized" }` — invalid or revoked API key
- 403: `{ "error": "insufficient_permissions" }` — only org admins or
  existing org members can create projects
- 409: `{ "error": "project_name_exists" }` — duplicate name within org
- 500: `{ "error": "creation_failed" }`

**Logic**:
1. Authenticate via Bearer token (API key -> member lookup)
2. Verify member belongs to the specified org
3. Validate project name (1-100 chars, unique within org)
4. Generate project invite code (`XXXX-XXXX` format)
5. INSERT into `projects` table
6. INSERT into `project_members`: creator becomes `project_admin`
7. Create audit entry: `project_created`
8. Return project metadata

**Plan limits**: Check `subscriptions.plan` for max projects:
- free: 1 project
- team: 10 projects
- business: 50 projects
- enterprise: unlimited

## POST /functions/v1/join-project (new)

Join a project via its invite code. Creates org membership if needed,
then adds project membership.

**Request**:

```json
{
  "invite_code": "ABCD-1234",
  "author_name": "Andriy"
}
```

**Response (200)**:

```json
{
  "org_id": "uuid",
  "org_name": "Krukit",
  "project_id": "uuid",
  "project_name": "frontend-app",
  "api_key": "tm_...",
  "member_key": "tmm_...",
  "member_count": 5,
  "decision_count": 42,
  "role": "project_member"
}
```

**Errors**:
- 400: `{ "error": "invite_code_required" }`
- 400: `{ "error": "author_name_required" }`
- 403: `{ "error": "member_limit_reached" }` — org member limit for plan
- 404: `{ "error": "invalid_invite_code" }` — no project found
- 409: `{ "error": "already_project_member" }` — already in this project
- 500: `{ "error": "join_failed" }`

**Logic**:
1. Look up project by invite code (case-insensitive)
2. Resolve org from `projects.org_id`
3. Check org member limit for plan
4. Check if author_name already exists as org member:
   - **Yes**: Skip org member creation. Check if already project member:
     - **Yes**: Return 409 `already_project_member`
     - **No**: Add to `project_members` as `project_member`
   - **No**: Create new org member with per-member API key (`tmm_`),
     then add to `project_members` as `project_member`
5. Create audit entries: `member_joined` (if new org member),
   `project_member_added`
6. Get project decision count
7. Return org + project metadata + credentials

**Backward compatibility**: This replaces `join-org` as the primary join
mechanism. The `join-org` endpoint remains functional for org-level
admin invites but is no longer used by `valis init --join`.

## POST /functions/v1/exchange-token (modified)

Changes from Phase 2 contract:

**Request** (authenticated via Bearer token — API key):

```json
{
  "project_id": "uuid"
}
```

The `project_id` field is optional. When provided, the minted JWT
includes a `project_id` claim for project-scoped RLS.

**Updated Response (200)**:

```json
{
  "token": "eyJhbG...",
  "expires_at": "2026-03-24T11:00:00Z",
  "member_id": "uuid",
  "org_id": "uuid",
  "org_name": "Krukit",
  "project_id": "uuid",
  "project_name": "frontend-app",
  "role": "admin",
  "project_role": "project_admin",
  "author_name": "Olena",
  "auth_mode": "jwt"
}
```

**Updated JWT Claims**:

```json
{
  "sub": "<member_id>",
  "role": "authenticated",
  "exp": "<now + 3600>",
  "iat": "<now>",
  "iss": "valis",
  "org_id": "<org_id>",
  "project_id": "<project_id>",
  "member_role": "admin",
  "project_role": "project_admin",
  "author_name": "<author_name>"
}
```

**Updated Logic** (additions to Phase 2):
1. (existing) Authenticate via Bearer token
2. (existing) Look up member
3. **NEW**: If `project_id` provided:
   a. Verify project exists and belongs to member's org
   b. Verify member is in `project_members` for this project
      OR member has `role = 'admin'` (org admins have implicit access)
   c. If no access: return 403 `{ "error": "no_project_access" }`
   d. Resolve `project_role` from `project_members.role`
4. Mint JWT with added `project_id` and `project_role` claims
5. Return updated response with project metadata

**Cross-project mode**: When the CLI needs cross-project search, it
calls `exchange-token` WITHOUT `project_id`. The resulting JWT has no
`project_id` claim, so RLS allows org-wide access. Application-level
filtering restricts to the member's accessible projects.

## POST /functions/v1/change-status (modified)

Changes from Phase 2 contract:

**Updated Logic** (additions):
1. (existing) Authenticate + resolve member
2. **NEW**: Extract `project_id` from JWT claims
3. **NEW**: Verify decision belongs to the JWT's `project_id`
4. **NEW**: Permission check uses project role:
   - `project_member`: can deprecate, promote
   - `project_admin` or `org admin`: can also supersede
5. (existing) Update decision status
6. (existing) Flag dependents, resolve contradictions
7. **NEW**: Audit entry includes `project_id`
8. Return result

**New Error**:
- 403: `{ "error": "wrong_project" }` — decision does not belong to
  the JWT's active project

## POST /functions/v1/check-usage (modified)

**Decision**: Usage scoping depends on the limit type:

| Limit | Scoped to |
|-------|-----------|
| decisions (storage) | Per org (billing unit) |
| searches (API calls) | Per org (billing unit) |
| members | Per org (billing unit) |
| projects | Per org (billing unit) |

Usage limits remain org-scoped because billing is at the org level.
A single org pays for all its projects combined. Individual project
usage is tracked in `rate_limits` with an additional `project_id`
column for per-project analytics, but limits are enforced at the org
level.

**Updated `rate_limits` table**:

```sql
ALTER TABLE rate_limits ADD COLUMN project_id UUID REFERENCES projects(id);
```

This allows `valis admin metrics --project frontend-app` to show
per-project usage, while limits are still checked at the org level
(`WHERE org_id = $1 AND day = CURRENT_DATE`).

## POST /functions/v1/rotate-key (modified)

Changes from Phase 2 contract:

**New rotation target**: `"rotate": "project_invite_code"`

```json
{
  "rotate": "project_invite_code",
  "project_id": "uuid"
}
```

**Logic addition**:
1. Verify caller is `project_admin` or `org admin`
2. Generate new invite code
3. UPDATE `projects.invite_code`
4. Create audit entry with `project_id`
5. Return new invite code

## Edge Function Summary

| Endpoint | Status | Changes |
|----------|--------|---------|
| `create-project` | NEW | Create project within org |
| `join-project` | NEW | Join via project invite code |
| `exchange-token` | MODIFIED | Accepts `project_id`, adds to JWT |
| `change-status` | MODIFIED | Validates `project_id` from JWT |
| `check-usage` | MODIFIED | Tracks per-project, enforces per-org |
| `rotate-key` | MODIFIED | Supports `project_invite_code` target |
| `create-org` | UNCHANGED | Still creates org (no default project) |
| `join-org` | DEPRECATED | Kept for backward compat, replaced by `join-project` |
| `revoke-member` | UNCHANGED | Revokes at org level (cascades to all projects) |
