# Research: Vercel API Migration

**Phase**: 0 — Outline & Research
**Date**: 2026-03-25

## Deno-to-Node.js Mapping

**Decision**: Each Supabase Deno Edge Function is mechanically
translated to a Next.js App Router API route. The translation follows
a consistent pattern.

### Import Mapping

| Deno (Edge Function) | Node.js (API Route) |
|---|---|
| `import { serve } from "https://deno.land/std@0.177.0/http/server.ts"` | Removed — Next.js exports handlers directly |
| `import { createClient } from "https://esm.sh/@supabase/supabase-js@2"` | `import { createClient } from '@supabase/supabase-js'` |
| `import { SignJWT } from "https://deno.land/x/jose@v5.2.0/index.ts"` | `import { SignJWT } from 'jose'` |
| `import Stripe from "https://esm.sh/stripe@14"` | `import Stripe from 'stripe'` |

### Handler Pattern Mapping

**Deno Edge Function**:
```typescript
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // ... handler logic
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

**Next.js API Route**:
```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // ... handler logic
  return NextResponse.json(body, { status: 200 });
}
```

### Environment Variable Mapping

| Deno | Node.js |
|---|---|
| `Deno.env.get("SUPABASE_URL")!` | `process.env.SUPABASE_URL!` |
| `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!` | `process.env.SUPABASE_SERVICE_ROLE_KEY!` |
| `Deno.env.get("JWT_SECRET")` | `process.env.JWT_SECRET` |
| `Deno.env.get("QDRANT_URL")` | `process.env.QDRANT_URL` |
| `Deno.env.get("QDRANT_API_KEY")` | `process.env.QDRANT_API_KEY` |
| `Deno.env.get("STRIPE_SECRET_KEY")` | `process.env.STRIPE_SECRET_KEY` |
| `Deno.env.get("STRIPE_WEBHOOK_SECRET")` | `process.env.STRIPE_WEBHOOK_SECRET` |
| (new) | `process.env.ANTHROPIC_API_KEY` |

### CORS Handling

**Current (per-function)**:
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
// Applied manually to every response
```

**After (global via next.config.ts)**:
```typescript
// next.config.ts
const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: '/api/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
        { key: 'Access-Control-Allow-Headers', value: 'authorization, x-client-info, apikey, content-type, stripe-signature' },
      ],
    }];
  },
};
```

**Why global**: Every EF has identical CORS headers. Centralizing them
eliminates ~150 lines of duplicated boilerplate across 13 routes and
prevents CORS misconfigurations.

### Crypto API

**Deno**: `crypto.subtle.timingSafeEqual()` is globally available.
**Node.js**: `crypto.timingSafeEqual()` from the `node:crypto` module.

```typescript
// Deno
crypto.subtle.timingSafeEqual(aBuf, bBuf);

// Node.js
import { timingSafeEqual } from 'node:crypto';
timingSafeEqual(Buffer.from(a), Buffer.from(b));
```

**Note**: The EF implementation of `timingSafeEqual` uses
`crypto.subtle.timingSafeEqual` with `TextEncoder`. In Node.js, use
`crypto.timingSafeEqual` from `node:crypto` with `Buffer`.

### UUID Generation

**Deno**: `crypto.randomUUID()` — globally available.
**Node.js**: `crypto.randomUUID()` — also globally available in
Node.js 20+. No change needed.

### Random Bytes for Key Generation

**Deno**: `crypto.getRandomValues(new Uint8Array(16))` — Web Crypto API.
**Node.js**: `crypto.getRandomValues(new Uint8Array(16))` — also
available in Node.js 20+ via Web Crypto. No change needed.

Alternatively, use `randomBytes(16)` from `node:crypto` for a more
idiomatic approach.

## Next.js API Route Patterns

### File Structure

Each route is a single file following the App Router convention:

```
packages/web/src/app/api/
├── register/route.ts
├── join-project/route.ts
├── join-org/route.ts
├── create-org/route.ts
├── create-project/route.ts
├── exchange-token/route.ts
├── change-status/route.ts
├── rotate-key/route.ts
├── revoke-member/route.ts
├── check-usage/route.ts
├── stripe-webhook/route.ts
├── create-checkout/route.ts
├── seed/route.ts
└── enrich/route.ts          # NEW — hosted enrichment
```

### Shared Utilities

Common patterns duplicated across all 13 EFs should be extracted:

1. **Supabase server client** (`packages/web/src/lib/supabase-server.ts`):
   Creates a Supabase client with `SUPABASE_SERVICE_ROLE_KEY`. Used by
   every route.

2. **Auth helpers** (`packages/web/src/lib/api-auth.ts`):
   - `extractBearerToken(request)`: Extracts and validates Bearer token
   - `authenticateApiKey(supabase, apiKey)`: Resolves member or org from
     API key, returns `{ memberId, orgId, role }` or null
   - `decodeJwtPayload(token)`: Decode JWT claims without verification

3. **Response helpers** (`packages/web/src/lib/api-response.ts`):
   - `jsonResponse(body, status)`: Create a JSON NextResponse
   - `unauthorized()`: 401 response
   - `forbidden(message)`: 403 response
   - `badRequest(message)`: 400 response
   - `notFound(message)`: 404 response

4. **Key generators** (`packages/web/src/lib/api-keys.ts`):
   - `generateOrgApiKey()`: `tm_` + 32 hex
   - `generateMemberKey()`: `tmm_` + 32 hex
   - `generateInviteCode()`: `XXXX-XXXX` format

**Why extract**: Every EF duplicates these. Extracting reduces ~400
lines of boilerplate and ensures consistent behavior (especially
timing-safe comparison and error response shapes).

### Runtime Configuration

Next.js API routes run as Vercel Serverless Functions (Node.js
runtime). Environment variables are set in the Vercel dashboard or
`.env.local` for development.

**Required env vars for Vercel deployment**:
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (server-only)
- `JWT_SECRET` — For signing custom JWTs
- `QDRANT_URL` — Qdrant Cloud cluster URL
- `QDRANT_API_KEY` — Qdrant API key
- `STRIPE_SECRET_KEY` — Stripe API key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signature secret
- `STRIPE_PRICE_TEAM_MONTHLY` — Stripe price ID
- `STRIPE_PRICE_TEAM_ANNUAL` — Stripe price ID
- `STRIPE_PRICE_BUSINESS_MONTHLY` — Stripe price ID
- `STRIPE_PRICE_BUSINESS_ANNUAL` — Stripe price ID
- `ANTHROPIC_API_KEY` — For hosted enrichment (new)

## CLI URL Strategy

### The Two-URL Model

After migration, the CLI operates with two distinct URLs:

1. **`HOSTED_API_URL`** (`https://teamind.krukit.co`) — Vercel
   deployment. Used for all "Edge Function" calls: register, exchange-
   token, check-usage, join-project, create-org, create-project,
   change-status, rotate-key, revoke-member, seed, enrich.

2. **`HOSTED_SUPABASE_URL`** (`https://rmawxpdaudinbansjfpd.supabase.co`)
   — Supabase project. Used for direct Postgres queries via
   `@supabase/supabase-js` client: store decisions, search (Postgres
   side), read audit logs, read members, etc.

**Why two URLs**: The Supabase client (`createClient`) needs the
Supabase project URL for direct database access (Postgres over HTTP,
Realtime WebSocket). The API routes need the Vercel URL for serverless
function invocation. These are different infrastructure components.

### URL Resolution Logic

```typescript
function resolveApiUrl(config: TeamindConfig, supabaseUrl: string): string {
  // Hosted mode: use Vercel API URL
  if (isHostedMode(config)) {
    return HOSTED_API_URL;
  }
  // Community mode: use Supabase EF URL
  return supabaseUrl;
}

function resolveApiPath(apiUrl: string, functionName: string): string {
  if (apiUrl === HOSTED_API_URL) {
    // Vercel: /api/<name>
    return `${apiUrl}/api/${functionName}`;
  }
  // Supabase: /functions/v1/<name>
  return `${apiUrl}/functions/v1/${functionName}`;
}
```

**Hosted mode detection**: A config has no `supabase_service_role_key`
(or it is empty) AND the `supabase_url` matches `HOSTED_SUPABASE_URL`.

### Files Requiring URL Changes

| File | Current Call | After |
|---|---|---|
| `cloud/registration.ts` | `${base}/functions/v1/register` | `${base}/api/register` |
| `cloud/registration.ts` | `${base}/functions/v1/join-project` | `${base}/api/join-project` |
| `auth/jwt.ts` | `${supabaseUrl}/functions/v1/exchange-token` | `${apiUrl}/api/exchange-token` |
| `billing/usage.ts` | `${supabaseUrl}/functions/v1/check-usage` | `${apiUrl}/api/check-usage` |
| `commands/init.ts` | `${supabaseUrl}/functions/v1/create-org` | `${apiUrl}/api/create-org` |
| `cloud/supabase.ts` | (create-project, join-project calls) | Updated for hosted mode |

### Backward Compatibility

Community mode is unaffected because:
1. Community config has `supabase_service_role_key` set.
2. `resolveApiUrl()` returns the supabase URL for community configs.
3. Community users deploy their own EFs to their own Supabase instance.
4. The `/functions/v1/` path is preserved for community API calls.

## Hosted Enrichment Design

**Decision**: The `/api/enrich` route is a new endpoint (not migrated
from an EF). It uses the server-side `ANTHROPIC_API_KEY` to enrich
pending decisions for hosted users.

**Authentication**: Bearer JWT (from `exchange-token`). The JWT claims
include `org_id`, `project_id`, `member_id`. The route verifies the
JWT and checks project membership before enriching.

**Flow**:
1. Client sends `POST /api/enrich` with `{ decision_ids: string[] }`
2. Route verifies JWT, extracts `org_id` + `project_id`
3. Route fetches decisions from Postgres (filtered by org_id +
   project_id + decision_ids)
4. Route calls Anthropic API for each decision:
   - Input: decision detail text
   - Output: type, summary, affects, confidence
5. Route updates Postgres: set type, summary, affects, confidence,
   `enriched_by: 'llm'`
6. Route updates Qdrant: sync payload with enriched fields
7. Route logs to `enrichment_usage` table (daily cost tracking)
8. Route returns enrichment results

**Cost ceiling**: Uses the existing `enrichment_usage` table. Before
enriching, check if the org has exceeded its daily enrichment budget
(plan-dependent). If exceeded, return 429.

**Alternatives considered**:
- **Background job via Supabase pg_cron**: More complex to set up,
  requires Supabase Pro plan for pg_cron. API route is simpler and
  gives immediate feedback.
- **Streaming enrichment**: Overkill for batch classification. The
  Anthropic call is fast (~1s per decision). A batch of 10 takes ~10s.

## Stripe Webhook Migration

**Special consideration**: The `stripe-webhook` handler verifies
webhook signatures using the raw request body. In Deno, `req.text()`
gives the raw body. In Next.js, `request.text()` also works, but the
Stripe SDK's `constructEvent` expects the raw body as a string.

**Key difference**: The Stripe SDK import changes from
`import Stripe from "https://esm.sh/stripe@14"` to
`import Stripe from 'stripe'`. The `stripe` npm package must be added
to `packages/web/package.json`.

**Webhook secret**: The `STRIPE_WEBHOOK_SECRET` env var is used for
signature verification. This must be updated in the Stripe dashboard
to point to the new Vercel URL.

## Deprecating Supabase Edge Functions

**Decision**: EFs are NOT deleted from the repository. They are kept
in `supabase/functions/` with a deprecation notice at the top of each
file. Community users who self-host on Supabase may still deploy them.

**Deprecation notice format**:
```typescript
/**
 * @deprecated Migrated to Vercel API route: packages/web/src/app/api/<name>/route.ts
 * This Edge Function is kept for community/self-hosted deployments only.
 * Hosted Teamind (teamind.krukit.co) uses Vercel API routes as of 006-vercel-api-migration.
 */
```

**Supabase's remaining role**:
1. Postgres database — migrations, RLS, RPC functions
2. Realtime — WebSocket push for cross-session notifications
3. Auth-free — no Supabase Auth used (Teamind has its own JWT)
