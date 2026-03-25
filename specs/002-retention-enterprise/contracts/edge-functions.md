# Edge Function Contracts: Phase 2

Extends `/specs/001-valis-mvp/contracts/edge-functions.md`.

## POST /functions/v1/exchange-token

Exchange an API key (org-level or per-member) for a short-lived JWT.

**Request** (authenticated via Bearer token — API key):

```json
{}
```

**Response (200)**:

```json
{
  "token": "eyJhbG...",
  "expires_at": "2026-03-23T11:00:00Z",
  "member_id": "uuid",
  "org_id": "uuid",
  "org_name": "Acme Engineering",
  "role": "admin",
  "author_name": "Olena",
  "auth_mode": "jwt"
}
```

**Errors**:
- 401: `{ "error": "unauthorized" }` — invalid or revoked key
- 500: `{ "error": "token_generation_failed" }`

**Logic**:
1. Extract Bearer token from Authorization header
2. Look up by `members.api_key` (per-member) OR `orgs.api_key` (legacy)
3. If per-member: check `revoked_at IS NULL`
4. If legacy org key: resolve to first admin member for attribution
5. Mint JWT (HS256, 1h expiry) with claims:
   `{ sub: member_id, role: 'authenticated', org_id, member_role, author_name }`
6. Sign with `JWT_SECRET` env var
7. Return token + metadata

**Backward compatibility**: Accepts both `tm_` (org-level) and
`tmm_` (per-member) keys. Config `auth_mode` in response tells CLI
which mode is active.

## POST /functions/v1/rotate-key

Rotate API key or invite code (admin only).

**Request** (authenticated via Bearer token — API key):

```json
{
  "rotate": "api_key" | "invite_code" | "member_key",
  "target_member_id": "uuid"
}
```

`target_member_id` required only when `rotate: "member_key"`.

**Response (200)**:

```json
{
  "rotated": "api_key",
  "new_value": "tm_new123...",
  "target_member_id": null
}
```

**Errors**:
- 401: `{ "error": "unauthorized" }` — invalid API key
- 403: `{ "error": "admin_required" }` — only admins can rotate
- 400: `{ "error": "invalid_rotate_target" }`
- 404: `{ "error": "member_not_found" }`

**Logic**:
1. Authenticate via Bearer token (API key lookup)
2. Verify admin role
3. For `api_key`: generate new `tm_` + 32 hex, UPDATE orgs
4. For `invite_code`: generate new `XXXX-XXXX`, UPDATE orgs
5. For `member_key`: generate new `tmm_` + 32 hex, UPDATE member
6. Create audit entry
7. Return new value

## POST /functions/v1/revoke-member

Revoke a member's API key (admin only).

**Request** (authenticated via Bearer token):

```json
{
  "member_id": "uuid"
}
```

**Response (200)**:

```json
{
  "revoked": true,
  "member_id": "uuid",
  "author_name": "Andriy"
}
```

**Errors**:
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "admin_required" }`
- 404: `{ "error": "member_not_found" }`

**Logic**:
1. Authenticate + verify admin
2. SET `members.revoked_at = now()` for target member
3. Create audit entry
4. Return confirmation

## POST /functions/v1/change-status

Change a decision's status (with permission checks).

**Request** (authenticated via Bearer token):

```json
{
  "decision_id": "uuid",
  "new_status": "deprecated" | "active",
  "reason": "Replaced by gRPC decision"
}
```

**Response (200)**:

```json
{
  "decision_id": "uuid",
  "old_status": "active",
  "new_status": "deprecated",
  "changed_by": "Olena",
  "flagged_dependents": ["uuid1", "uuid2"]
}
```

**Errors**:
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "insufficient_permissions" }` — non-admin trying
  to supersede without being original author
- 404: `{ "error": "decision_not_found" }`
- 400: `{ "error": "invalid_transition" }` — e.g., deprecated → proposed

**Logic**:
1. Authenticate + resolve member
2. Validate transition: proposed→active (any), active→deprecated (any),
   active→superseded (admin or original author only)
3. UPDATE decision status + status_changed_by/at/reason
4. If deprecated: find decisions with `depends_on` containing this ID,
   return as `flagged_dependents`
5. If deprecated/superseded: resolve any open contradictions involving
   this decision
6. Create audit entry
7. Return result
