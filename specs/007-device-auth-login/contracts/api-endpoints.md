# API Contracts: Device Authorization Login

## POST /api/device-code

**Auth**: None (public endpoint)
**Rate limit**: 3 per IP per hour

**Request**: `{}`

**Response 201**:
```json
{
  "user_code": "ABCD-1234",
  "device_code": "550e8400-e29b-41d4-a716-446655440000",
  "verification_url": "https://valis.krukit.co/auth/device?code=ABCD-1234",
  "expires_in": 900,
  "interval": 5
}
```

**Response 429**: `{ "error": "rate_limit_exceeded" }`

---

## POST /api/device-authorize

**Auth**: None (device_code in body acts as secret)

**Request**:
```json
{
  "device_code": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response 200** (approved):
```json
{
  "member_api_key": "tmm_ef0cf9cea7378d8b857a211b32ca4a05",
  "member_id": "uuid",
  "author_name": "Dmytro",
  "org_id": "uuid",
  "org_name": "krukit",
  "supabase_url": "https://rmawxpdaudinbansjfpd.supabase.co",
  "qdrant_url": "",
  "qdrant_api_key": ""
}
```

**Response 202** (pending): `{ "status": "authorization_pending" }`

**Response 410** (expired): `{ "error": "expired" }`

**Response 403** (denied): `{ "error": "denied" }`

**Response 404** (not found): `{ "error": "invalid_device_code" }`

---

## POST /api/device-approve

**Auth**: Supabase Auth session (cookie-based)

**Request**:
```json
{
  "user_code": "ABCD-1234",
  "action": "approve"
}
```

**Response 200** (approved):
```json
{
  "status": "approved",
  "org_name": "krukit",
  "author_name": "Dmytro"
}
```

**Request (deny)**:
```json
{
  "user_code": "ABCD-1234",
  "action": "deny"
}
```

**Response 200** (denied): `{ "status": "denied" }`

**Response 401**: `{ "error": "unauthorized" }` (no Supabase Auth session)

**Response 404**: `{ "error": "code_not_found" }` (invalid or already used code)

**Response 410**: `{ "error": "expired" }` (code expired)

---

## POST /api/register (modified)

**New field**: `email` (optional for backward compatibility)

**Request**:
```json
{
  "org_name": "krukit",
  "project_name": "PBaaS",
  "author_name": "Dmytro",
  "email": "dmytro@krukit.co"
}
```

When `email` is provided:
1. Store in `members.email`
2. Create Supabase Auth user via `supabase.auth.admin.createUser({ email })`
3. No confirmation email sent — magic link sent on first dashboard login

---

## CLI Commands

### valis login (device flow)

```
$ valis login
Opening browser for authentication...
  URL: https://valis.krukit.co/auth/device?code=ABCD-1234
  Code: ABCD-1234

Waiting for approval... (press Ctrl+C to cancel)
✓ Logged in as Dmytro (krukit)
```

### valis login --api-key (fallback)

```
$ valis login --api-key
? Enter your member API key (tmm_...): ****
✓ Logged in as Dmytro (krukit)
```

---

## Dashboard Pages

### /auth/login

- Email input + "Send magic link" button
- On submit: `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })`
- Redirect URL: original page (from `?redirect=` param) or `/dashboard`
- Dark mode, centered card layout

### /auth/device?code=XXXX-YYYY

- Requires Supabase Auth session → redirect to `/auth/login?redirect=...` if not
- Shows: device code, "Approve" / "Deny" buttons
- On approve: POST `/api/device-approve` → success message
- On deny: POST `/api/device-approve` with `action: "deny"` → denied message
- Shows org name + member name for confirmation
