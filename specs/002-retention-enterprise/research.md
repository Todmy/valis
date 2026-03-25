# Research: Retention, Collaboration & Enterprise Readiness

**Phase**: 0 — Outline & Research
**Date**: 2026-03-23

## Supabase Realtime for Cross-Session Push

**Decision**: Use Supabase Realtime `postgres_changes` subscriptions
filtered by `org_id` on the `decisions` table.

**API**:
```typescript
supabase
  .channel(`org:${orgId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'decisions',
    filter: `org_id=eq.${orgId}`,
  }, (payload) => { /* payload.new = inserted row */ })
  .subscribe()
```

**Rationale**: Native to Supabase, no additional infrastructure. RLS
is enforced per-subscriber for INSERT/UPDATE events. The `filter`
parameter reduces RLS evaluation overhead by pre-filtering at the
replication level.

**Alternatives considered**:
- **Polling**: Simpler but 5s delivery target impossible without
  aggressive polling (500ms intervals × N orgs = excessive load).
- **Supabase Broadcast**: No persistence, no RLS integration. Better
  for ephemeral messages but decisions need DB backing anyway.
- **External pub/sub (Redis, NATS)**: Additional infrastructure,
  violates zero-native-deps and cloud-first principles.

**Limitations**:
- DELETE events do NOT respect RLS — not relevant (we never delete).
- 200 concurrent connections (free), 500 (pro). Adequate for MVP
  scale (3-50 devs per org, few orgs initially).
- 100 msgs/sec (free), 500 (pro). Adequate — one decision store
  generates one event.
- Payload max 1MB — decisions are well under this.
- Each INSERT triggers per-subscriber RLS check. With filter param
  and simple RLS policy, performance is acceptable for <50 devs/org.

## Custom JWT for Per-Member Auth

**Decision**: Mint custom JWTs in an Edge Function. CLI exchanges
API key for a short-lived JWT. All subsequent Supabase calls use
the JWT via `createClient({ accessToken })`.

**JWT Claims**:
```json
{
  "sub": "<member_id>",
  "role": "authenticated",
  "exp": "<now + 3600>",
  "iat": "<now>",
  "iss": "valis",
  "org_id": "<org_id>",
  "member_role": "admin|member",
  "author_name": "<author_name>"
}
```

**Client usage**:
```typescript
const supabase = createClient(url, anonKey, {
  accessToken: async () => cachedJwt,
})
```

**RLS policy pattern**:
```sql
CREATE POLICY decisions_org_isolation ON decisions
  FOR ALL
  USING (org_id::text = (current_setting('request.jwt.claims', true)::json->>'org_id'))
  WITH CHECK (org_id::text = (current_setting('request.jwt.claims', true)::json->>'org_id'));
```

Or using `auth.jwt()`:
```sql
USING (org_id::text = (select auth.jwt()->>'org_id'))
```

**Rationale**: Standard pattern for third-party auth with Supabase.
The `accessToken` option was designed for this use case. `jose`
library already in the dependency tree. Eliminates `service_role`
key from client code.

**Alternatives considered**:
- **Supabase Auth (email/password)**: Overkill — developers don't
  want another login. API keys are the right UX for CLI tools.
- **Keep service_role + set_config**: Works but bypasses native RLS,
  violates Constitution X (Identity-First Access Control).

**Key implementation detail**: JWT secret must be set as Edge Function
secret via `supabase secrets set JWT_SECRET=<value>`. It is NOT a
default env var in Edge Functions.

## API Key → JWT Exchange Flow

**Decision**: New Edge Function `POST /functions/v1/exchange-token`.

**Flow**:
1. CLI sends `Authorization: Bearer tm_xxx` to Edge Function
2. Edge Function looks up member by `api_key` (service_role access)
3. Validates: key exists, not revoked, member active
4. Mints JWT with `jose` (HS256, 1h expiry)
5. Returns `{ token, expires_at, member_id, org_id, role }`
6. CLI caches token, refreshes before expiry

**Rationale**: Separates authentication (API key validation) from
authorization (JWT for RLS). Short-lived JWTs limit blast radius of
token theft. Edge Function is trusted server-side code.

**Backward compatibility**: MVP org-level API key continues to work
via the existing `service_role` path. The exchange-token endpoint
accepts both org-level and per-member keys. Config includes a flag
`auth_mode: 'legacy' | 'jwt'` to control which path the CLI uses.

## Contradiction Detection Strategy

**Decision**: Two-tier detection — `affects` area overlap (required)
+ embedding cosine similarity (enhancement).

**Tier 1 — Area overlap** (always runs):
- On store, query active decisions with overlapping `affects` arrays
- SQL: `SELECT * FROM decisions WHERE org_id = $1 AND status = 'active'
  AND affects && $2` (array overlap operator)
- If matches found → candidates for contradiction

**Tier 2 — Embedding similarity** (runs on candidates):
- For each candidate, compute cosine distance between new decision
  and candidate in Qdrant
- If similarity > 0.7 AND area overlap → flag as potential contradiction
- If Qdrant unavailable → area overlap alone is sufficient

**Rationale**: Area overlap is cheap, deterministic, and catches most
cases. Embedding similarity reduces false positives (two decisions
about "auth" that don't actually contradict). No LLM needed —
satisfies Constitution IV.

**Alternatives considered**:
- **LLM-based comparison**: Higher accuracy but adds cost, latency,
  and hard dependency. Violates Principle IV.
- **Pure embedding similarity**: Too many false positives without area
  filtering. "Use PostgreSQL for users" and "Use PostgreSQL for logs"
  are similar but not contradictory.
- **Area overlap only**: Acceptable as MVP. Embedding similarity is
  an enhancement that can be added incrementally.

## Audit Trail Storage

**Decision**: New `audit_entries` table in Postgres. Not replicated
to Qdrant (audit data is not searchable via semantic search).

**Rationale**: Audit entries are structured, time-ordered records.
SQL queries (filter by member, action, date range) are the natural
access pattern. No vector search needed.

**Retention**: No automatic expiry in Phase 2. Retention policy
deferred to Phase 3 (compliance features).

## Migration Strategy

**Decision**: New migration `002_retention_enterprise.sql`. Additive
only — no column drops, no type changes. Existing data untouched.

**Changes**:
- `members` table: ADD `api_key` (nullable, unique), ADD `revoked_at`
- `decisions` table: ADD `replaces` (nullable FK), ADD `depends_on`
  (UUID array)
- New table: `audit_entries`
- New table: `contradictions`
- New RPC functions for lifecycle operations
- Updated RLS policies for JWT-based auth (coexist with legacy)

**Backward compatibility**: `members.api_key` is nullable — existing
members without keys use legacy org-level auth. New members get keys
at join time. Migration is non-breaking.
