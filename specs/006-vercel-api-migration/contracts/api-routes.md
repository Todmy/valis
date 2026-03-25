# API Route Contracts: Vercel API Migration

**Date**: 2026-03-25
**Source**: Supabase Edge Functions in `supabase/functions/`
**Target**: Next.js API routes in `packages/web/src/app/api/`

All routes accept `POST` only. CORS is handled globally via
`next.config.ts`. Each route exports `async function POST(request: NextRequest)`.

---

## 1. POST /api/register

**Source**: `supabase/functions/register/index.ts` (333 lines)
**Auth**: None (public endpoint, rate-limited by IP)

**Request**:
```json
{
  "org_name": "string (1-100 chars, alphanumeric + spaces + hyphens)",
  "project_name": "string (1-100 chars, alphanumeric + spaces + hyphens)",
  "author_name": "string (1-100 chars)"
}
```

**Response 201**:
```json
{
  "member_api_key": "tmm_...",
  "supabase_url": "https://rmawxpdaudinbansjfpd.supabase.co",
  "qdrant_url": "https://c424cb8c-....qdrant.io",
  "qdrant_api_key": "string (read-only key, optional)",
  "org_id": "uuid",
  "org_name": "string",
  "project_id": "uuid",
  "project_name": "string",
  "invite_code": "XXXX-XXXX",
  "member_id": "uuid"
}
```

**Error Responses**:
- `400`: `{ "error": "org_name_required" | "project_name_required" | "author_name_required" | "invalid_name", "field"?: "org_name" | "project_name" }`
- `409`: `{ "error": "org_name_taken" }`
- `429`: `{ "error": "rate_limit_exceeded" }`
- `500`: `{ "error": "creation_failed", "message": "string" }`

**Notes**: Rate limit: max 10 registrations per IP per hour. Uses
`registration_rate_limits` table. Atomic: creates org + member +
project + project_member or rolls back all.

---

## 2. POST /api/join-project

**Source**: `supabase/functions/join-project/index.ts` (282 lines)
**Auth**: None (public endpoint)

**Request**:
```json
{
  "invite_code": "string (project invite code, XXXX-XXXX format)",
  "author_name": "string"
}
```

**Response 200**:
```json
{
  "org_id": "uuid",
  "org_name": "string",
  "project_id": "uuid",
  "project_name": "string",
  "member_api_key": "tmm_...",
  "member_id": "uuid",
  "supabase_url": "string",
  "qdrant_url": "string",
  "qdrant_api_key": "string (optional)",
  "member_count": 3,
  "decision_count": 42,
  "role": "project_member"
}
```

**Error Responses**:
- `400`: `{ "error": "invite_code_required" | "author_name_required" }`
- `404`: `{ "error": "invalid_invite_code" }`
- `409`: `{ "error": "already_member" }`
- `403`: `{ "error": "member_limit_reached" }`

---

## 3. POST /api/join-org

**Source**: `supabase/functions/join-org/index.ts` (143 lines)
**Auth**: None (public endpoint)

**Request**:
```json
{
  "invite_code": "string (org invite code)",
  "author_name": "string"
}
```

**Response 200**:
```json
{
  "org_id": "uuid",
  "org_name": "string",
  "api_key": "tm_...",
  "invite_code": "string",
  "member_id": "uuid",
  "member_api_key": "tmm_...",
  "role": "member"
}
```

**Error Responses**:
- `400`: `{ "error": "invite_code_required" | "author_name_required" }`
- `404`: `{ "error": "invalid_invite_code" }`
- `409`: `{ "error": "already_member" }`
- `403`: `{ "error": "member_limit_reached" }`

---

## 4. POST /api/create-org

**Source**: `supabase/functions/create-org/index.ts` (113 lines)
**Auth**: None (public endpoint)

**Request**:
```json
{
  "name": "string",
  "author_name": "string"
}
```

**Response 200**:
```json
{
  "org_id": "uuid",
  "api_key": "tm_...",
  "invite_code": "XXXX-XXXX",
  "author_name": "string",
  "role": "admin",
  "member_id": "uuid",
  "member_api_key": "tmm_..."
}
```

**Error Responses**:
- `400`: `{ "error": "name_required" | "author_name_required" }`
- `500`: `{ "error": "creation_failed", "message": "string" }`

---

## 5. POST /api/create-project

**Source**: `supabase/functions/create-project/index.ts` (271 lines)
**Auth**: Bearer token (org API key `tm_` or per-member key `tmm_`)

**Request**:
```json
{
  "org_id": "uuid (optional if resolvable from API key)",
  "project_name": "string"
}
```

**Response 201**:
```json
{
  "project_id": "uuid",
  "project_name": "string",
  "invite_code": "XXXX-XXXX",
  "org_id": "uuid"
}
```

**Error Responses**:
- `400`: `{ "error": "project_name_required" | "invalid_project_name" }`
- `401`: `{ "error": "unauthorized" }`
- `403`: `{ "error": "project_limit_reached" | "admin_required" }`
- `500`: `{ "error": "creation_failed", "message": "string" }`

---

## 6. POST /api/exchange-token

**Source**: `supabase/functions/exchange-token/index.ts` (317 lines)
**Auth**: Bearer token (org API key `tm_` or per-member key `tmm_`)

**Request**:
```json
{
  "project_id": "uuid (optional — omit for org-level JWT)"
}
```

**Response 200**:
```json
{
  "token": "eyJ... (JWT string)",
  "expires_at": "ISO-8601 datetime",
  "member_id": "uuid",
  "org_id": "uuid",
  "org_name": "string",
  "role": "admin | member",
  "author_name": "string",
  "auth_mode": "jwt",
  "project_id": "uuid (if requested)",
  "project_name": "string (if requested)",
  "project_role": "project_admin | project_member (if requested)"
}
```

**Error Responses**:
- `401`: `{ "error": "unauthorized" }`
- `403`: `{ "error": "project_access_denied" }`
- `500`: `{ "error": "token_generation_failed" }`

**Notes**: Signs JWT with `JWT_SECRET` using `jose` npm package.
JWT includes claims: `sub` (member_id), `org_id`, `role`,
`author_name`, `project_id` (optional), `project_role` (optional).
Token lifetime: 1 hour.

---

## 7. POST /api/change-status

**Source**: `supabase/functions/change-status/index.ts` (339 lines)
**Auth**: Bearer token (API key or JWT)

**Request**:
```json
{
  "decision_id": "uuid",
  "new_status": "active | deprecated | superseded",
  "reason": "string (optional)"
}
```

**Response 200**:
```json
{
  "decision_id": "uuid",
  "old_status": "string",
  "new_status": "string",
  "changed_by": "string (author_name)",
  "member_id": "uuid"
}
```

**Error Responses**:
- `400`: `{ "error": "decision_id_required" | "invalid_status" | "invalid_transition" }`
- `401`: `{ "error": "unauthorized" }`
- `403`: `{ "error": "project_access_denied" }`
- `404`: `{ "error": "decision_not_found" }`

**Notes**: Validates transition rules (proposed->active,
active->deprecated/superseded). Creates audit log entry. Sends
Realtime notification.

---

## 8. POST /api/rotate-key

**Source**: `supabase/functions/rotate-key/index.ts` (347 lines)
**Auth**: Bearer token (API key — must be admin)

**Request**:
```json
{
  "target": "org | member | invite",
  "member_id": "uuid (required when target=member)"
}
```

**Response 200 (target=org)**:
```json
{
  "new_api_key": "tm_...",
  "target": "org",
  "org_id": "uuid"
}
```

**Response 200 (target=member)**:
```json
{
  "new_api_key": "tmm_...",
  "target": "member",
  "member_id": "uuid"
}
```

**Response 200 (target=invite)**:
```json
{
  "new_invite_code": "XXXX-XXXX",
  "target": "invite",
  "org_id": "uuid"
}
```

**Error Responses**:
- `400`: `{ "error": "invalid_target" | "member_id_required" }`
- `401`: `{ "error": "unauthorized" }`
- `403`: `{ "error": "admin_required" | "cannot_rotate_own_key" }`
- `404`: `{ "error": "member_not_found" }`

---

## 9. POST /api/revoke-member

**Source**: `supabase/functions/revoke-member/index.ts` (190 lines)
**Auth**: Bearer token (API key — must be admin)

**Request**:
```json
{
  "member_id": "uuid",
  "force": false
}
```

**Response 200**:
```json
{
  "member_id": "uuid",
  "revoked_at": "ISO-8601 datetime",
  "revoked_by": "uuid (admin member_id)"
}
```

**Error Responses**:
- `400`: `{ "error": "member_id_required" }`
- `401`: `{ "error": "unauthorized" }`
- `403`: `{ "error": "admin_required" | "cannot_revoke_self" | "cannot_revoke_last_admin" }`
- `404`: `{ "error": "member_not_found" | "already_revoked" }`

---

## 10. POST /api/check-usage

**Source**: `supabase/functions/check-usage/index.ts` (317 lines)
**Auth**: Bearer JWT

**Request**:
```json
{
  "org_id": "uuid",
  "operation": "store | search"
}
```

**Response 200 (allowed)**:
```json
{
  "allowed": true,
  "plan": "free | team | business | enterprise",
  "overage": false
}
```

**Response 200 (denied)**:
```json
{
  "allowed": false,
  "plan": "free",
  "reason": "Free tier limit reached (500 decisions).",
  "upgrade": {
    "message": "Upgrade to Team ($29/mo) for 5,000 decisions.",
    "checkout_url": null
  }
}
```

**Response 200 (overage)**:
```json
{
  "allowed": true,
  "plan": "team",
  "overage": true,
  "overage_rate": "$0.005/decision"
}
```

**Error Responses**:
- `401`: `{ "error": "unauthorized" }`

**Notes**: Decodes JWT to extract org_id. Checks plan limits against
`rate_limits` and `orgs` tables. Plan limits: free=500 decisions/
100 searches, team=5000/1000, business=25000/5000, enterprise=unlimited.

---

## 11. POST /api/stripe-webhook

**Source**: `supabase/functions/stripe-webhook/index.ts` (249 lines)
**Auth**: Stripe webhook signature (`stripe-signature` header)

**Request**: Raw Stripe event body (verified via `STRIPE_WEBHOOK_SECRET`)

**Response 200**:
```json
{ "received": true }
```

**Error Responses**:
- `400`: `{ "error": "webhook_error", "message": "string" }`

**Handled Events**:
- `checkout.session.completed` — Create/update subscription
- `customer.subscription.updated` — Update plan/status
- `customer.subscription.deleted` — Mark subscription cancelled
- `invoice.payment_failed` — Update status to `past_due`

**Notes**: Uses `stripe.webhooks.constructEvent()` for signature
verification. Must read raw body (`request.text()`, not `.json()`).

---

## 12. POST /api/create-checkout

**Source**: `supabase/functions/create-checkout/index.ts` (150 lines)
**Auth**: Bearer token (API key or JWT)

**Request**:
```json
{
  "org_id": "uuid",
  "plan": "team | business",
  "billing_cycle": "monthly | annual",
  "success_url": "string (redirect URL)",
  "cancel_url": "string (redirect URL)"
}
```

**Response 200**:
```json
{
  "checkout_url": "https://checkout.stripe.com/..."
}
```

**Error Responses**:
- `400`: `{ "error": "missing_parameters" }`
- `401`: `{ "error": "unauthorized" }`
- `500`: `{ "error": "misconfigured" }` (missing STRIPE_SECRET_KEY)

---

## 13. POST /api/seed

**Source**: `supabase/functions/seed/index.ts` (252 lines)
**Auth**: Bearer token (per-member key `tmm_` or org key `tm_`)

**Request**:
```json
{
  "project_id": "uuid",
  "decisions": [
    {
      "text": "string",
      "type": "decision | constraint | pattern | lesson",
      "summary": "string (optional)",
      "affects": ["string"] ,
      "confidence": 0.8,
      "source": "seed",
      "session_id": "string (optional)"
    }
  ]
}
```

**Response 200**:
```json
{
  "stored": 5,
  "skipped": 2,
  "total": 7,
  "errors": ["string (optional error messages)"]
}
```

**Error Responses**:
- `400`: `{ "error": "project_id_required" | "decisions_required" }`
- `401`: `{ "error": "unauthorized" }`

**Notes**: Stores decisions to both Postgres and Qdrant server-side.
Deduplicates by content_hash. Uses service_role key internally.

---

## 14. POST /api/enrich (NEW)

**Source**: New endpoint (no EF equivalent)
**Auth**: Bearer JWT

**Request**:
```json
{
  "decision_ids": ["uuid", "uuid", ...]
}
```

**Response 200**:
```json
{
  "enriched": [
    {
      "decision_id": "uuid",
      "type": "decision | constraint | pattern | lesson",
      "summary": "string",
      "affects": ["string"],
      "confidence": 0.85,
      "tokens_used": 150,
      "cost_cents": 0.3
    }
  ],
  "skipped": ["uuid (already enriched)"],
  "total_cost_cents": 0.9,
  "daily_budget_remaining_cents": 99.1
}
```

**Error Responses**:
- `400`: `{ "error": "decision_ids_required" }`
- `401`: `{ "error": "unauthorized" }`
- `403`: `{ "error": "community_users_use_local_enrich" }`
- `429`: `{ "error": "daily_enrichment_budget_exceeded" }`
- `503`: `{ "error": "enrichment_unavailable", "message": "ANTHROPIC_API_KEY not configured" }`

**Notes**: Uses server-side `ANTHROPIC_API_KEY`. Enforces daily cost
ceiling per org via `enrichment_usage` table. Updates Postgres
decisions (type, summary, affects, confidence, enriched_by='llm')
and Qdrant payload. Processes up to 20 decisions per call.

---

## Shared Utilities

### packages/web/src/lib/supabase-server.ts

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createServerClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
```

### packages/web/src/lib/api-auth.ts

```typescript
export function extractBearerToken(request: NextRequest): string | null;
export async function authenticateApiKey(
  supabase: SupabaseClient,
  apiKey: string,
): Promise<{ memberId: string; orgId: string; role: string; authorName: string } | null>;
export function decodeJwtPayload(token: string): Record<string, unknown>;
export function timingSafeEqual(a: string, b: string): boolean;
```

### packages/web/src/lib/api-response.ts

```typescript
export function jsonResponse(body: unknown, status: number): NextResponse;
export function unauthorized(): NextResponse;
export function forbidden(message: string): NextResponse;
export function badRequest(message: string): NextResponse;
export function notFound(message: string): NextResponse;
```

### packages/web/src/lib/api-keys.ts

```typescript
export function generateOrgApiKey(): string;   // tm_ + 32 hex
export function generateMemberKey(): string;    // tmm_ + 32 hex
export function generateInviteCode(): string;   // XXXX-XXXX
```
