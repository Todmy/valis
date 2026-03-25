# Data Model: Registration API

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-24
**Extends**: `/specs/004-multi-project/data-model.md`

## Schema Changes (Migration 005)

Migration 005 is minimal. The registration feature creates orgs,
projects, and members using **existing** tables from migrations 001-004.
No new entities are needed for the core flow.

The only new table supports rate limiting for the public registration
endpoint.

### RegistrationRateLimit (new)

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, default `gen_random_uuid()` |
| ip_address | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, default `now()` |

**Purpose**: Track registration attempts per IP address for rate
limiting. Each successful call to `/functions/v1/register` inserts a
row. The Edge Function counts rows per IP in the last hour before
allowing a new registration.

**Retention**: Rows older than 24 hours can be safely deleted. A
periodic cleanup (or lazy deletion during rate limit checks) keeps
the table small.

**Indexes**:
```sql
CREATE INDEX idx_registration_rate_limits_ip_time
  ON registration_rate_limits (ip_address, created_at DESC);
```

The composite index supports the query:
```sql
SELECT count(*) FROM registration_rate_limits
WHERE ip_address = $1 AND created_at > now() - interval '1 hour';
```

### Migration SQL

```sql
-- Migration 005: Registration API rate limiting
-- Additive only — no changes to existing tables

CREATE TABLE IF NOT EXISTS registration_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registration_rate_limits_ip_time
  ON registration_rate_limits (ip_address, created_at DESC);

-- RLS: only service_role can access this table (Edge Functions run as service_role)
ALTER TABLE registration_rate_limits ENABLE ROW LEVEL SECURITY;
-- No RLS policies = only service_role can read/write (Edge Functions use service_role)
```

## Existing Tables Used (No Changes)

The registration flow uses these existing tables from migrations
001-004:

| Table | Operation | Notes |
|-------|-----------|-------|
| `orgs` | INSERT | New org with `api_key` (org-level, `tm_` prefix) and `invite_code` |
| `members` | INSERT | New admin member with `api_key` (per-member, `tmm_` prefix) |
| `projects` | INSERT | Default project with `invite_code` |
| `project_members` | INSERT | Creator as `project_admin` |
| `audit_entries` | INSERT | `org_created`, `member_joined`, `project_created` |

The `join-project` endpoint (modified) uses:

| Table | Operation | Notes |
|-------|-----------|-------|
| `projects` | SELECT | Look up by `invite_code` |
| `orgs` | SELECT | Get org details |
| `members` | SELECT/INSERT | Find existing or create new |
| `project_members` | INSERT | Add to project |
| `audit_entries` | INSERT | `member_joined`, `project_member_added` |

## Entity Relationship (Registration Flow)

```
register request
  └─> orgs (INSERT)
       └─> members (INSERT, role=admin, api_key=tmm_...)
            └─> projects (INSERT, with invite_code)
                 └─> project_members (INSERT, role=project_admin)
                      └─> audit_entries (3 INSERTs)
                           └─> registration_rate_limits (INSERT, ip tracking)
```

## Config Impact

After registration, the CLI config stores:

**~/.valis/config.json** (hosted mode — NO service_role_key):
```json
{
  "org_id": "uuid",
  "org_name": "My Org",
  "supabase_url": "https://xyz.supabase.co",
  "qdrant_url": "https://xyz.qdrant.io",
  "member_api_key": "tmm_...",
  "member_id": "uuid",
  "author_name": "Alice",
  "invite_code": "ABCD-1234",
  "configured_ides": [],
  "created_at": "..."
}
```

**.valis.json** (per-directory):
```json
{
  "project_id": "uuid",
  "project_name": "my-project"
}
```

Note: `supabase_service_role_key` and `qdrant_api_key` are absent from
hosted mode config. All subsequent operations use `exchange-token` with
the per-member API key to get a JWT.
