# API Contracts: Web Project Member Management

## POST /api/invite-member

**Auth**: Supabase Auth session (Bearer token)

**Request**:
```json
{
  "project_id": "uuid",
  "email": "user@example.com"
}
```

**Response 200** (invited, existing user):
```json
{
  "status": "invited",
  "member_name": "Dmytro",
  "is_new_user": false
}
```

**Response 201** (invited, new user created):
```json
{
  "status": "invited",
  "member_name": "user@example.com",
  "is_new_user": true
}
```

**Response 400**: `{ "error": "email_required" }` or `{ "error": "invalid_email" }`

**Response 401**: `{ "error": "unauthorized" }`

**Response 403**: `{ "error": "not_project_admin" }`

**Response 409**: `{ "error": "already_member" }`

**Response 429**: `{ "error": "rate_limit_exceeded", "message": "Max 10 invitations per hour per project" }`

---

## POST /api/remove-member

**Auth**: Supabase Auth session (Bearer token)

**Request**:
```json
{
  "project_id": "uuid",
  "member_id": "uuid"
}
```

**Response 200**: `{ "status": "removed" }`

**Response 400**: `{ "error": "cannot_remove_self" }`

**Response 400**: `{ "error": "cannot_remove_last_admin" }`

**Response 401**: `{ "error": "unauthorized" }`

**Response 403**: `{ "error": "not_project_admin" }`

**Response 404**: `{ "error": "member_not_found" }`

---

## Dashboard Pages

### /projects/[id] (Project Detail)

**Auth**: Supabase Auth session (via useDashboardAuth)

**Shows**:
- Project name
- Member count
- Member list: name, email, role badge, joined date
- Invite form (admin only): email input + "Invite" button
- Remove button per member (admin only, not for self)

**Queries**:
- `projects.select('*').eq('id', params.id).single()`
- `project_members.select('*, members(id, author_name, email, role)').eq('project_id', params.id)`

**Dark mode**: Consistent with dashboard (bg-gray-950/900, text-gray-100)
