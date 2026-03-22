# Supabase Edge Function Contracts: Teamind MVP

All functions are unauthenticated (public) — they create or validate
credentials, so they can't require them.

## POST /functions/v1/create-org

Create a new organization and its first admin member.

**Request**:

```json
{
  "name": "Acme Engineering",
  "author_name": "Olena"
}
```

**Response (201)**:

```json
{
  "org_id": "uuid",
  "api_key": "tm_abc123...",
  "invite_code": "ACME-7X3K",
  "author_name": "Olena",
  "role": "admin"
}
```

**Errors**:
- 400: `{ "error": "name_required" }` — missing or empty name
- 400: `{ "error": "author_name_required" }` — missing author
- 500: `{ "error": "creation_failed", "message": "..." }`

**Logic**:
1. Generate UUID for org
2. Generate API key: `tm_` + 32 hex chars
3. Generate invite code: `XXXX-XXXX` (uppercase alphanumeric)
4. INSERT org + INSERT member (admin role) in transaction
5. Return credentials

## POST /functions/v1/join-org

Join an existing organization using an invite code.

**Request**:

```json
{
  "invite_code": "ACME-7X3K",
  "author_name": "Andriy"
}
```

**Response (200)**:

```json
{
  "org_id": "uuid",
  "org_name": "Acme Engineering",
  "api_key": "tm_abc123...",
  "member_count": 3,
  "decision_count": 47,
  "role": "member"
}
```

**Errors**:
- 400: `{ "error": "invite_code_required" }`
- 404: `{ "error": "invalid_invite_code" }` — code doesn't match any org
- 409: `{ "error": "already_member" }` — author_name already in org
- 403: `{ "error": "member_limit_reached" }` — free tier: 3 members max

**Logic**:
1. Look up org by invite_code
2. Check member limit (free: 3, pro: 50)
3. INSERT member (member role)
4. Return org context with counts

## POST /functions/v1/rotate-key

Rotate API key or invite code (admin only).

**Request** (authenticated via Bearer token — existing API key):

```json
{
  "rotate": "api_key"
}
```

or

```json
{
  "rotate": "invite_code"
}
```

**Response (200)**:

```json
{
  "api_key": "tm_new123...",
  "rotated": "api_key"
}
```

**Errors**:
- 401: `{ "error": "unauthorized" }` — invalid API key
- 403: `{ "error": "admin_required" }` — only admins can rotate
- 400: `{ "error": "invalid_rotate_target" }` — must be api_key or invite_code
