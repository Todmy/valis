# Research: Registration API

**Phase**: 0 — Outline & Research
**Date**: 2026-03-24

## Atomic Registration via Single Edge Function

**Decision**: Registration is a single public Edge Function
(`/functions/v1/register`) that creates an org, default project, and
first member atomically in one call. It composes the logic of
`create-org` and `create-project` server-side rather than having the
CLI call them sequentially.

**Why not reuse create-org + create-project from the CLI?**
- `create-org` returns an org-level API key (`tm_`), not a per-member
  key. The client would need the service_role key to call
  `create-project` next (it requires a Bearer token). The whole point
  of this feature is to avoid service_role keys on the client.
- Sequential calls from the CLI risk partial state: org created but
  project creation fails, leaving an orphaned org with no project.
- A single atomic Edge Function simplifies error handling and rollback.

**Internal implementation**: The `register` Edge Function runs
server-side with `SUPABASE_SERVICE_ROLE_KEY` (from Deno env) and
performs three INSERTs in order: org, member (with `tmm_` per-member
key), project + project_member. On any failure, preceding inserts are
rolled back manually (DELETE).

**Response shape**:
```json
{
  "member_api_key": "tmm_...",
  "supabase_url": "https://xyz.supabase.co",
  "qdrant_url": "https://xyz.qdrant.io",
  "org_id": "uuid",
  "org_name": "My Org",
  "project_id": "uuid",
  "project_name": "my-project",
  "invite_code": "ABCD-1234"
}
```

**Key omissions from response**: No `service_role_key`, no
`qdrant_api_key`, no `api_key` (org-level key). Only the per-member
key (`tmm_`) is returned. The Supabase URL and Qdrant URL are public
endpoint addresses (not secrets).

**Alternatives considered**:
- **CLI calls create-org then create-project**: Requires service_role
  key on client for the create-project call. Violates FR-002/FR-004.
- **Two-step: register-org (public) then create-project (authenticated
  via tmm_ key)**: Possible but the CLI would need two round trips and
  the register-org endpoint would still be a new endpoint. Single call
  is simpler and more robust.
- **Supabase Auth signup flow**: Would couple Teamind to Supabase Auth
  (email/password). Teamind uses API keys, not auth identities.

## Public URLs as Constants

**Decision**: The Supabase URL and Qdrant URL for hosted mode are
hardcoded as constants in the `register` Edge Function response and
in the CLI. They are not secrets — they are public API endpoint
addresses discoverable via DNS.

**Rationale**: Hosted Teamind runs on fixed infrastructure. The
Supabase project URL (`https://xyz.supabase.co`) and Qdrant cluster
URL (`https://xyz.qdrant.io`) do not change between registrations.
Including them in the registration response means the CLI does not
need to know them in advance — the server tells the client where to
connect.

**Why include them in the response instead of hardcoding in the CLI?**
- Future-proofing: if Teamind adds regional endpoints, the server can
  return the closest one.
- Single source of truth: the server knows the infrastructure topology.
- The CLI becomes infrastructure-agnostic — it connects wherever the
  registration response tells it to.

## Rate Limiting via Database Counter

**Decision**: Rate limiting for the public registration endpoint uses
a database table `registration_rate_limits` with columns
`(ip_address TEXT, created_at TIMESTAMPTZ)`. Before each registration,
the Edge Function counts rows with the same IP in the last hour. If
the count exceeds 10, the request is rejected with 429.

**Why database-based instead of in-memory?**
- Supabase Edge Functions are stateless — no shared memory across
  invocations or isolates.
- A database counter persists across cold starts and scales with
  multiple Edge Function instances.
- Simple cleanup: a scheduled job (or lazy cleanup on next check)
  deletes rows older than 1 hour.

**Schema**:
```sql
CREATE TABLE registration_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registration_rate_limits_ip_time
  ON registration_rate_limits (ip_address, created_at);
```

**Alternatives considered**:
- **In-memory rate limiter (e.g., Map)**: Does not persist across
  Edge Function cold starts. Supabase isolates are short-lived.
- **Redis/Upstash**: Adds a new dependency and cost. Overkill for
  ~100 registrations/day in early stages.
- **Supabase `rate_limits` table (existing)**: That table is scoped to
  authenticated org usage tracking. Registration rate limiting is
  pre-authentication (no org exists yet). Separate table keeps concerns
  clean.

## CLI Init Rewrite for Hosted Mode

**Decision**: The `initCommand` function in
`packages/cli/src/commands/init.ts` replaces the `resolveCredentials`
hosted path with a call to the registration API. The `loadHostedEnv()`
function, `HOSTED_CREDENTIALS` constant, and `parseEnvContent()` helper
are removed entirely.

**New hosted flow**:
```
1. User runs `teamind init` → chooses Hosted
2. Prompt: org name, project name, your name
3. CLI calls POST /functions/v1/register
4. Response: { member_api_key, supabase_url, qdrant_url, org_id, ... }
5. CLI saves config:
   - ~/.teamind/config.json: supabase_url, qdrant_url, member_api_key,
     org_id, org_name, author_name (NO service_role_key)
   - .teamind.json: project_id, project_name
6. IDE configuration, Qdrant setup, seed (using exchange-token flow)
```

**Community flow**: Unchanged. User provides Supabase URL, service_role
key, Qdrant URL, Qdrant API key manually. Config includes
`supabase_service_role_key` as before.

**Key difference**: Hosted mode config has `member_api_key` but NO
`supabase_service_role_key`. Community mode config has
`supabase_service_role_key` but may or may not have `member_api_key`.
The CLI detects mode from config: if `supabase_service_role_key` is
present, it is community mode; otherwise, it is hosted mode using
exchange-token for all operations.

## Join-Public Edge Function

**Decision**: A new Edge Function `join-public`
(`/functions/v1/join-public`) provides the same atomic join experience
for new users with an invite code. Unlike `join-project` (which exists
from Phase 4), `join-public` is a fully public endpoint — no Bearer
token needed. It accepts `{ invite_code, author_name }` and returns
credentials.

**Why not reuse join-project?**
- `join-project` from Phase 4 works fine for the join logic itself.
  However, `join-public` is a thin wrapper that:
  1. Delegates to the same join logic (look up project by invite code,
     create member, add to project)
  2. Additionally returns `supabase_url` and `qdrant_url` in the
     response (like `register` does)
  3. Requires NO authentication (public endpoint)
- `join-project` already accepts unauthenticated requests (no Bearer
  required per the 004 contract). So `join-public` is essentially
  `join-project` with the addition of `supabase_url` and `qdrant_url`
  in the response. We could modify `join-project` directly instead of
  creating a new endpoint.

**Final decision**: Modify `join-project` to include `supabase_url`
and `qdrant_url` in its response rather than creating a separate
`join-public` endpoint. The CLI's `--join` path then calls
`join-project` and gets everything it needs. This avoids endpoint
proliferation.

**Fallback**: If `join-project` modification proves too risky for
backward compatibility, create `join-public` as a separate function
that delegates to the same logic.

## Removing .hosted-env Dependency

**Decision**: After the registration API ships, the following are
removed from `packages/cli/src/commands/init.ts`:

1. `HOSTED_CREDENTIALS` constant (lines 35-40)
2. `parseEnvContent()` function (lines 42-53)
3. `loadHostedEnv()` function (lines 55-69)
4. All references to `TEAMIND_HOSTED_*` env vars in `resolveCredentials`
5. The error message directing users to create `.hosted-env`

**Migration for existing users**: Existing users who have
`~/.teamind/config.json` with a `supabase_service_role_key` from the
old hosted setup are on the "legacy hosted" path. A deprecation
warning guides them to re-run `teamind init` which will use the
registration API instead. The old config continues to work (community
mode path) but the user is nudged to re-register.

**Rationale**: The `.hosted-env` file was a temporary solution for
dogfooding. It distributed service_role keys to client machines — an
anti-pattern that violates Constitution X (Identity-First Access
Control). The registration API eliminates this entirely.
