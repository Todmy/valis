# Data Model: Teamind MVP

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-22

## Entities

### Organization

The top-level tenant. One org = one isolated team brain.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, auto-generated |
| name | text | NOT NULL, 1-100 chars |
| api_key | text | UNIQUE, NOT NULL, generated (32 hex chars) |
| invite_code | text | UNIQUE, NOT NULL, format `XXXX-XXXX` |
| plan | text | NOT NULL, default `'free'`, enum: free/pro/enterprise |
| decision_count | integer | NOT NULL, default 0 |
| created_at | timestamptz | NOT NULL, default now() |

**Identity**: UUID primary key.
**Uniqueness**: api_key and invite_code are globally unique.

### Member

A person belonging to an organization.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, auto-generated |
| org_id | UUID | NOT NULL, FK → orgs.id |
| author_name | text | NOT NULL, 1-50 chars |
| role | text | NOT NULL, default `'member'`, enum: admin/member |
| joined_at | timestamptz | NOT NULL, default now() |

**Identity**: UUID primary key.
**Uniqueness**: (org_id, author_name) should be unique within an org.

**MVP trade-off**: design-spec-v5 defines per-member API keys
(`members.api_key`). MVP uses org-level API key + local author_name
instead — simpler key distribution, adequate for attribution. Per-member
keys (individual revocation, audit trail) deferred to Phase 2 RBAC.

### Decision

The core data object. Stored in both Postgres and Qdrant.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, auto-generated |
| org_id | UUID | NOT NULL, FK → orgs.id |
| type | text | NOT NULL, enum: decision/constraint/pattern/lesson/pending |
| summary | text | NULL, max 100 chars |
| detail | text | NOT NULL, min 10 chars |
| status | text | NOT NULL, default `'active'`, enum: active/deprecated/superseded/proposed |
| author | text | NOT NULL, dev name or `'agent'` |
| source | text | NOT NULL, enum: mcp_store/file_watcher/stop_hook/seed |
| project_id | text | NULL, project directory name |
| session_id | text | NULL, for cross-layer dedup |
| content_hash | text | NOT NULL, SHA-256 of normalized text |
| confidence | integer | NULL, 1-10 |
| affects | text[] | Default empty array |
| created_at | timestamptz | NOT NULL, default now() |
| updated_at | timestamptz | NOT NULL, default now() |

**Identity**: UUID primary key + content_hash for dedup.
**Uniqueness**: (org_id, content_hash) prevents duplicate decisions.

**Qdrant payload** (mirrored, not all fields):
- id, org_id, type, summary, detail, status, author, source, affects,
  confidence, created_at
- Qdrant generates dense (384d) + sparse (BM25) vectors from `detail` field.
- All queries filter by `org_id` payload field (indexed).

### Rate Limit

Per-org daily operation counters.

| Field | Type | Constraints |
|-------|------|-------------|
| org_id | UUID | NOT NULL, FK → orgs.id |
| day | date | NOT NULL, default CURRENT_DATE |
| store_count | integer | NOT NULL, default 0 |
| search_count | integer | NOT NULL, default 0 |

**Identity**: Composite primary key `(org_id, day)` — no separate UUID.
Matches v5 schema exactly.

## Relationships

```
Organization 1 ──── * Member
Organization 1 ──── * Decision
Organization 1 ──── * RateLimit
```

- An Organization has many Members (1 admin at creation, others join via invite).
- An Organization has many Decisions.
- An Organization has many RateLimit rows (one per day with activity).
- A Decision belongs to exactly one Organization.

## State Transitions

### Decision.status

```
proposed → active → deprecated
                  → superseded
```

- **proposed**: Tentative, under discussion (Phase 2 — not used in MVP).
- **active**: Current, authoritative (default on creation).
- **deprecated**: No longer valid but kept for history (Phase 2 — manual
  status change not in MVP scope).
- **superseded**: Replaced by a newer decision (Phase 2 — requires
  `replaces` relationship field).

**MVP scope**: All decisions are created as `active`. Status transitions
are Phase 2. The `pending` type (for auto-captured raw text) is a type,
not a status — pending decisions have `status: active`.

### Decision.type

- **decision**: "We chose PostgreSQL for user data"
- **constraint**: "Client requires Safari 15+ support"
- **pattern**: "All API endpoints use /api/v1/{resource}"
- **lesson**: "Don't use connection pooling with serverless functions"
- **pending**: Auto-captured raw text, not yet classified by an agent

## Validation Rules

- Organization.name: 1-100 non-empty characters.
- Organization.invite_code: format `XXXX-XXXX` (uppercase alphanumeric).
- Decision.detail: minimum 10 characters (prevents noise).
- Decision.summary: maximum 100 characters when provided.
- Decision.confidence: integer 1-10 when provided.
- Decision.affects: array of strings, each 1-50 chars.
- Member.author_name: 1-50 non-empty characters.
- All text fields: must pass secret detection (10 patterns) before storage.

## Data Volume Assumptions (MVP)

| Metric | Free tier | Expected max (paid) |
|--------|-----------|---------------------|
| Decisions per org | 500 | 10,000 |
| Members per org | 5 | 50 |
| Store ops per day | 100 | 1,000 |
| Search ops per day | 100 | 2,000 |

## Indexes

**Postgres**:
- `orgs.api_key` (unique, used for auth on every request)
- `orgs.invite_code` (unique, used for join)
- `decisions.org_id` (filter all queries by org)
- `decisions.(org_id, type)` (composite, for type-filtered queries)
- `decisions.(org_id, content_hash)` (unique, dedup)
- `decisions.session_id` (for cross-layer dedup lookups)
- `decisions.created_at` (sort by recency)
- `rate_limits.(org_id, day)` (composite PK, daily counter lookup)

**Qdrant**:
- `org_id` payload index (keyword, used as filter on every query)
- `type` payload index (keyword, optional filter)

## Row Level Security (RLS)

Postgres RLS enforces tenant isolation at the database level:

- **decisions**: `SELECT/INSERT/UPDATE/DELETE` restricted to rows where
  `org_id` matches the authenticated org. Policy uses `current_setting('app.org_id')`.
- **members**: Same pattern — scoped to `org_id`.
- **rate_limits**: Same pattern — scoped to `org_id`.
- **orgs**: Accessible only via API key lookup in Edge Functions.

RLS is enforced server-side. Even if client code has a bug, cross-org
data leakage is impossible at the database layer.

## MVP Naming Differences from v5

| v5 field | MVP field | Reason |
|----------|-----------|--------|
| `members.name` | `members.author_name` | Clarity — distinguishes from org name |
| `members.created_at` | `members.joined_at` | Semantic accuracy — members join, not create |
| `members.api_key` | (omitted) | MVP trade-off — org-level key only, Phase 2 RBAC |
| `rate_limits PK` | Composite `(org_id, day)` | Aligned with v5 — no unnecessary UUID |
