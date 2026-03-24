# Data Model: Multi-Project Support

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-24
**Extends**: `/specs/002-retention-enterprise/data-model.md`

## Schema Changes (Migration 004)

Migration 004 introduces project-level isolation. It is additive where
possible but includes a controlled type change for `decisions.project_id`
(TEXT to UUID FK) following the constitution's deprecation cycle: add
new column, migrate data, remove old column.

### Project (new)

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, auto-generated |
| org_id | UUID | NOT NULL, FK -> orgs.id ON DELETE CASCADE |
| name | TEXT | NOT NULL, CHECK (char_length(name) BETWEEN 1 AND 100) |
| invite_code | TEXT | UNIQUE, NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL, default now() |

**Identity**: UUID primary key.
**Uniqueness**: `(org_id, name)` unique — no duplicate project names
within an org. `invite_code` globally unique.

**invite_code**: Format `XXXX-XXXX` (same as org invite codes). Each
project gets its own invite code for project-scoped invites.

**Indexes**:
- `projects.org_id` (for listing projects in an org)
- `projects.invite_code` (unique, for invite code lookup)
- `(projects.org_id, projects.name)` (unique, for name dedup)

### ProjectMember (new)

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, auto-generated |
| project_id | UUID | NOT NULL, FK -> projects.id ON DELETE CASCADE |
| member_id | UUID | NOT NULL, FK -> members.id ON DELETE CASCADE |
| role | TEXT | NOT NULL, CHECK (role IN ('project_admin', 'project_member')) |
| joined_at | TIMESTAMPTZ | NOT NULL, default now() |

**Identity**: UUID primary key.
**Uniqueness**: `(project_id, member_id)` unique — a member can only
have one role per project.

**Indexes**:
- `(project_members.project_id, project_members.member_id)` (unique)
- `project_members.member_id` (for "list all projects for a member")

### Decision (modified)

| Field | Type | Constraints | Change |
|-------|------|-------------|--------|
| project_id | UUID | FK -> projects.id, nullable during migration | TYPE CHANGE: TEXT -> UUID |

**Migration strategy** (three-step deprecation cycle):

1. **ADD** new column `project_id_new UUID` (nullable, FK to projects.id)
2. **BACKFILL**: For each org, create a default project. Then:
   ```sql
   UPDATE decisions d
   SET project_id_new = p.id
   FROM projects p
   WHERE p.org_id = d.org_id
     AND p.name = 'default'
     AND d.project_id_new IS NULL;
   ```
3. **SWAP**: Drop old `project_id TEXT`, rename `project_id_new` to
   `project_id`, add NOT NULL constraint.

After migration, `project_id` is a required UUID FK on all decisions.

**Updated index**:
- `idx_decisions_org_id` remains (backward compat with existing queries)
- ADD `idx_decisions_project_id` on `decisions(project_id)` for
  project-scoped queries
- ADD `idx_decisions_project_hash` unique on `(project_id, content_hash)`
  — deduplication is now per-project, not per-org

**Note**: The unique index `idx_decisions_org_hash` on `(org_id,
content_hash)` is replaced by `(project_id, content_hash)`. The same
decision text in two different projects should be allowed (they are
independent knowledge bases).

### Contradiction (modified)

| Field | Type | Constraints | Change |
|-------|------|-------------|--------|
| project_id | UUID | NOT NULL, FK -> projects.id | ADD |

Contradictions are project-scoped. A decision in project A cannot
contradict a decision in project B (they are independent).

**Updated indexes**:
- DROP `idx_contradictions_org_status`
- ADD `idx_contradictions_project_status` on
  `contradictions(project_id, status)`

### AuditEntry (modified)

| Field | Type | Constraints | Change |
|-------|------|-------------|--------|
| project_id | UUID | nullable, FK -> projects.id | ADD |

Project ID is nullable because some audit actions are org-level (e.g.,
`org_key_rotated`). Decision-related actions include `project_id`.

**New audit actions**: Add to the action CHECK constraint:
- `project_created`
- `project_member_added`
- `project_member_removed`
- `migration_default_project`

**Updated indexes**:
- KEEP `idx_audit_entries_org_created`
- ADD `idx_audit_entries_project_created` on
  `audit_entries(project_id, created_at DESC)` WHERE `project_id IS NOT NULL`

## Data Migration Script

The migration runs as a single transaction:

```sql
BEGIN;

-- 1. Create projects table
CREATE TABLE projects (...);

-- 2. Create project_members table
CREATE TABLE project_members (...);

-- 3. For each existing org, create a default project
INSERT INTO projects (id, org_id, name, invite_code, created_at)
SELECT
  gen_random_uuid(),
  o.id,
  'default',
  o.invite_code,  -- reuse org's invite code for default project
  now()
FROM orgs o;

-- 4. Add project_id_new to decisions
ALTER TABLE decisions ADD COLUMN project_id_new UUID REFERENCES projects(id);

-- 5. Backfill decisions with default project
UPDATE decisions d
SET project_id_new = p.id
FROM projects p
WHERE p.org_id = d.org_id
  AND p.name = 'default'
  AND d.project_id_new IS NULL;

-- 6. Swap columns
ALTER TABLE decisions DROP COLUMN project_id;
ALTER TABLE decisions RENAME COLUMN project_id_new TO project_id;
ALTER TABLE decisions ALTER COLUMN project_id SET NOT NULL;

-- 7. Create project_members for all existing members
--    Org admins become project_admin, members become project_member
INSERT INTO project_members (id, project_id, member_id, role, joined_at)
SELECT
  gen_random_uuid(),
  p.id,
  m.id,
  CASE WHEN m.role = 'admin' THEN 'project_admin' ELSE 'project_member' END,
  now()
FROM members m
JOIN projects p ON p.org_id = m.org_id AND p.name = 'default';

-- 8. Add project_id to contradictions
ALTER TABLE contradictions ADD COLUMN project_id UUID REFERENCES projects(id);

-- Backfill contradictions: resolve project from decision_a_id
UPDATE contradictions c
SET project_id = d.project_id
FROM decisions d
WHERE c.decision_a_id = d.id
  AND c.project_id IS NULL;

ALTER TABLE contradictions ALTER COLUMN project_id SET NOT NULL;

-- 9. Add project_id to audit_entries (nullable — org-level actions have no project)
ALTER TABLE audit_entries ADD COLUMN project_id UUID REFERENCES projects(id);

-- 10. Create audit entries for the migration
INSERT INTO audit_entries (id, org_id, member_id, action, target_type, target_id, new_state, reason)
SELECT
  gen_random_uuid(),
  p.org_id,
  (SELECT m.id FROM members m WHERE m.org_id = p.org_id AND m.role = 'admin' LIMIT 1),
  'migration_default_project',
  'org',
  p.org_id,
  json_build_object('project_id', p.id, 'project_name', p.name)::jsonb,
  'Automatic migration: created default project for multi-project support'
FROM projects p
WHERE p.name = 'default';

COMMIT;
```

## Qdrant Payload Changes

### New payload field: `project_id`

All decision upserts now include `project_id` in the payload.

**New payload index** (created during `ensureCollection`):
```typescript
await qdrant.createPayloadIndex(COLLECTION_NAME, {
  field_name: 'project_id',
  field_schema: 'keyword',
});
```

**Backfill strategy**: Existing points without `project_id` are updated
lazily. When a decision is next searched or upserted, the `project_id`
is added to the payload. For the interim period, search filters use:
```typescript
// Include points with matching project_id OR missing project_id (legacy)
{
  should: [
    { key: 'project_id', match: { value: projectId } },
    {
      must_not: [
        { key: 'project_id', match: { any: ['*'] } }  // field does not exist
      ]
    }
  ]
}
```

Or use a background migration job that iterates all points in the
collection and sets `project_id` for each, using the Postgres decisions
table as source of truth.

## Relationships (updated)

```
Organization 1 ---- * Project (new)
Organization 1 ---- * Member (unchanged)
Organization 1 ---- * AuditEntry (gains project_id)
Organization 1 ---- * RateLimit (unchanged)

Project 1 ---- * Decision (project_id FK)
Project 1 ---- * ProjectMember (new)
Project 1 ---- * Contradiction (gains project_id)
Project 1 ---- 1 InviteCode (projects.invite_code)

Member 1 ---- * ProjectMember (member can be in multiple projects)
Member 1 ---- * AuditEntry (unchanged)

Decision 1 ---- 0..1 Decision (replaces -> superseded)
Decision 1 ---- * Decision (depends_on, array)
Decision * ---- * Contradiction (via decision_a_id, decision_b_id)
```

## State Transitions (updated)

### Decision.status (unchanged)

```
proposed -> active       (any project member)
active -> deprecated     (any project member)
active -> superseded     (project_admin or org admin, via replaces)
```

### Project lifecycle

Projects do not have a status field in Phase 4. Deletion is a future
feature. For now, projects are permanent once created.

## Validation Rules (new/updated)

- `projects.name`: 1-100 chars, unique within org
- `projects.invite_code`: format `XXXX-XXXX`, globally unique
- `project_members.role`: must be `project_admin` or `project_member`
- `project_members`: unique (project_id, member_id)
- `decisions.project_id`: NOT NULL after migration, must reference
  existing project in the same org
- `contradictions.project_id`: NOT NULL after migration, both decisions
  in the pair must belong to the same project
- `audit_entries.project_id`: nullable (org-level actions have no
  project)

## RLS Policy Changes

### Helper function: effective_project_id

```sql
CREATE OR REPLACE FUNCTION effective_project_id()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.project_id', true), ''),
    (SELECT auth.jwt()->>'project_id')
  );
$$;
```

### Updated policies

```sql
-- Projects: org-scoped read (members see all projects in their org)
CREATE POLICY projects_org_read ON projects
  FOR SELECT
  USING (org_id::text = effective_org_id());

-- Projects: write via service_role only (Edge Functions create projects)

-- Project members: read own project memberships
CREATE POLICY project_members_read ON project_members
  FOR SELECT
  USING (
    member_id::text = (SELECT auth.jwt()->>'sub')
    OR EXISTS (
      SELECT 1 FROM members m
      WHERE m.id::text = (SELECT auth.jwt()->>'sub')
        AND m.role = 'admin'
        AND m.org_id = (
          SELECT p.org_id FROM projects p WHERE p.id = project_members.project_id
        )
    )
  );

-- Decisions: project-scoped isolation (replaces org-only policy)
DROP POLICY IF EXISTS decisions_org_isolation ON decisions;
CREATE POLICY decisions_project_isolation ON decisions
  FOR ALL
  USING (
    org_id::text = effective_org_id()
    AND (
      project_id::text = effective_project_id()
      OR effective_project_id() IS NULL  -- legacy clients without project context
    )
  )
  WITH CHECK (
    org_id::text = effective_org_id()
    AND project_id::text = effective_project_id()
  );

-- Contradictions: project-scoped
DROP POLICY IF EXISTS contradictions_org_read ON contradictions;
CREATE POLICY contradictions_project_read ON contradictions
  FOR SELECT
  USING (
    org_id::text = effective_org_id()
    AND (
      project_id::text = effective_project_id()
      OR effective_project_id() IS NULL
    )
  );

-- Audit entries: org-scoped read (unchanged — audit trail is org-wide)
-- Kept as-is: audit_entries_org_read
```

### Cross-project search RLS

For `--all-projects` queries, the JWT does NOT include a `project_id`
claim. Instead, the exchange-token returns a JWT with only `org_id`.
RLS falls back to the `effective_project_id() IS NULL` branch, which
returns all decisions in the org. Application-level filtering then
restricts results to projects the member has access to (via
`project_members` table).

This is a pragmatic compromise: true per-project RLS for default
queries, with application-level filtering for cross-project queries.
The org-level RLS still prevents cross-org leakage.

## Updated RPC Functions

### search_decisions (modified)

```sql
CREATE OR REPLACE FUNCTION search_decisions(
  p_org_id UUID,
  p_project_id UUID,
  p_query TEXT,
  p_type TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 10
)
RETURNS SETOF decisions
LANGUAGE sql STABLE
AS $$
  SELECT *
  FROM decisions
  WHERE org_id = p_org_id
    AND project_id = p_project_id
    AND (p_type IS NULL OR type = p_type)
    AND (
      detail ILIKE '%' || p_query || '%'
      OR summary ILIKE '%' || p_query || '%'
    )
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;
```

### get_dashboard_stats (modified)

```sql
CREATE OR REPLACE FUNCTION get_dashboard_stats(
  p_org_id UUID,
  p_project_id UUID
)
RETURNS JSON
LANGUAGE sql STABLE
AS $$
  SELECT json_build_object(
    'total_decisions', (SELECT count(*) FROM decisions WHERE org_id = p_org_id AND project_id = p_project_id),
    'by_type', (
      SELECT json_object_agg(type, cnt)
      FROM (SELECT type, count(*) as cnt FROM decisions WHERE org_id = p_org_id AND project_id = p_project_id GROUP BY type) t
    ),
    'by_author', (
      SELECT json_object_agg(author, cnt)
      FROM (SELECT author, count(*) as cnt FROM decisions WHERE org_id = p_org_id AND project_id = p_project_id GROUP BY author) a
    ),
    'pending_count', (SELECT count(*) FROM decisions WHERE org_id = p_org_id AND project_id = p_project_id AND type = 'pending')
  );
$$;
```

### find_contradictions (modified)

```sql
CREATE OR REPLACE FUNCTION find_contradictions(
  p_org_id UUID,
  p_project_id UUID,
  p_affects TEXT[]
)
RETURNS SETOF decisions
LANGUAGE sql STABLE
AS $$
  SELECT *
  FROM decisions
  WHERE org_id = p_org_id
    AND project_id = p_project_id
    AND status = 'active'
    AND affects && p_affects
  ORDER BY created_at DESC;
$$;
```

### list_member_projects (new)

```sql
CREATE OR REPLACE FUNCTION list_member_projects(
  p_member_id UUID
)
RETURNS TABLE (
  project_id UUID,
  project_name TEXT,
  project_role TEXT,
  org_id UUID,
  org_name TEXT,
  decision_count BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id AS project_id,
    p.name AS project_name,
    pm.role AS project_role,
    o.id AS org_id,
    o.name AS org_name,
    (SELECT count(*) FROM decisions d WHERE d.project_id = p.id) AS decision_count
  FROM project_members pm
  JOIN projects p ON p.id = pm.project_id
  JOIN orgs o ON o.id = p.org_id
  WHERE pm.member_id = p_member_id
  ORDER BY p.name;
$$;
```

## Data Volume Assumptions (Phase 4)

| Metric | Expected range |
|--------|---------------|
| Projects per org | 1-20 |
| Members per project | 1-25 |
| Decisions per project | 50-5000 |
| Cross-project searches per day | 5-50 (infrequent) |
| Project invite joins per day | 0-5 |
| Default project migrations | 1 per existing org (one-time) |
