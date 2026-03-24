# Research: Multi-Project Support

**Phase**: 0 — Outline & Research
**Date**: 2026-03-24

## Per-Directory Config Resolution

**Decision**: Use a two-tier config model. Global config at
`~/.teamind/config.json` stores org credentials (shared across all
projects). Per-directory config at `.teamind.json` in the project root
stores `project_id` and `project_name`. The CLI resolves the active
project by walking up from `process.cwd()` to find `.teamind.json`.

**Resolution algorithm**:
```
1. Start at process.cwd()
2. Check for .teamind.json in current directory
3. If not found, walk up to parent directory
4. Repeat until found or filesystem root reached
5. If found: merge with global ~/.teamind/config.json
6. If not found: return global config only (no active project)
```

**`.teamind.json` schema**:
```json
{
  "project_id": "uuid",
  "project_name": "frontend-app"
}
```

**Global `~/.teamind/config.json`** (unchanged fields):
```json
{
  "org_id": "uuid",
  "org_name": "Krukit",
  "api_key": "tm_...",
  "supabase_url": "https://...",
  "supabase_service_role_key": "...",
  "qdrant_url": "https://...",
  "qdrant_api_key": "...",
  "author_name": "Olena",
  "auth_mode": "jwt",
  "member_api_key": "tmm_...",
  "member_id": "uuid",
  "configured_ides": ["claude-code"],
  "created_at": "..."
}
```

**Rationale**: Global config contains secrets (API keys, service role
keys) that should be stored once with restrictive permissions (`0600`)
in the home directory. Per-directory config contains only non-secret
project metadata and should be committed to version control so all
team members on the same repo automatically use the same project. The
walk-up algorithm matches `.git` resolution behavior that developers
already expect.

**Alternatives considered**:
- **Single config file with project array**: Complex merging, no
  automatic per-directory switching, forces manual `teamind switch`.
- **Symlinks**: Fragile, platform-dependent, confusing for users.
- **Environment variable `TEAMIND_PROJECT_ID`**: Works for CI but
  forces manual setup per terminal. Per-directory file is set-and-forget.

**Edge cases**:
- Nested repos: the closest `.teamind.json` wins (child overrides parent).
- No `.teamind.json` found: CLI reports "No project configured" and
  prompts user to run `teamind init`.
- `.teamind.json` exists but global config missing: CLI reports
  "Run `teamind init` to configure org credentials."

## Config Split: Global vs Per-Directory

**Decision**: Remove `project_id` from global config. The existing
`TeamindConfig` type keeps all org-level fields. A new `ProjectConfig`
type represents the per-directory `.teamind.json`. The effective runtime
config is `ResolvedConfig = TeamindConfig & { project?: ProjectConfig }`.

**Why not put `project_id` in global config?**
- A developer may work on 5+ repos in different terminals simultaneously.
  Global config would require a `teamind switch` before each context
  change.
- Per-directory config makes `cd` the switch command. No additional
  mental overhead.

**Migration from pre-project config**: Existing installations have no
`.teamind.json` anywhere. After upgrade, `teamind init` detects the
global config, creates a default project in the org, and writes
`.teamind.json` in the current directory. See Migration Strategy below.

## Project-Scoped Invite Codes

**Decision**: Invite codes move from org-level (`orgs.invite_code`) to
project-level (`projects.invite_code`). Each project gets its own unique
invite code. `teamind init --join <code>` now resolves to a specific
project (and its parent org).

**Flow**:
```
1. New member runs: teamind init --join ABCD-1234
2. CLI calls POST /functions/v1/join-project { invite_code, author_name }
3. Edge Function resolves project from invite_code
4. Creates member in org (if not already) + project_member in project
5. Returns org_id, org_name, project_id, project_name, api_key
6. CLI saves global config (org creds) + .teamind.json (project)
```

**Backward compatibility**: Existing `orgs.invite_code` column is kept
for org-level admin invites but is no longer used by the CLI `--join`
flow. The migration creates a default project per org and assigns the
org's existing invite code to the default project.

**Rationale**: Project-scoped invites align with Constitution XI
(Project-Scoped Isolation). A frontend contractor should join only the
frontend project, not get access to all projects in the org.

**Alternatives considered**:
- **Keep org-level invites, add project selection after join**: Two-step
  flow is worse UX. The invite code should encode the target project.
- **Invite URLs with project embedded**: Good long-term but requires a
  web service. Short codes are simpler for CLI.

## Migration Strategy: Default Project

**Decision**: Migration 004 creates a "default" project for every
existing org. All existing decisions (which have `project_id = NULL` or
`project_id` as a free-text field) are assigned to the default project.

**Steps**:
```sql
-- 1. Create projects table
-- 2. For each org, INSERT a default project
-- 3. ALTER decisions: change project_id from TEXT to UUID FK
-- 4. UPDATE decisions SET project_id = default_project.id WHERE project_id IS NULL
-- 5. Create project_members for all existing members (as project_member of default)
-- 6. Admins of the org automatically become project_admin of default
```

**Qdrant migration**: Existing Qdrant points do not have `project_id`
in their payload. A background job (or lazy migration during the next
upsert) adds `project_id` to each point. Until migrated, points without
`project_id` are included in searches for the default project via a
filter that matches either `project_id = default_project_id` OR
`project_id IS NULL` (missing field).

**Rationale**: Zero data loss, backward compatible. Existing
installations continue working immediately after migration. The default
project acts as a catch-all. Users can later create additional projects
and move decisions if needed (future feature, not in scope).

**Risk**: The `project_id` column type changes from `TEXT` (free-form)
to `UUID` (FK to projects). This is handled via a two-step migration:
1. Add `project_id_new UUID FK` column (nullable)
2. Backfill: `UPDATE decisions SET project_id_new = default_project.id`
3. Drop old `project_id TEXT`, rename `project_id_new` to `project_id`
4. Add NOT NULL constraint after backfill

This is a destructive change but follows the constitution's deprecation
cycle: add new, migrate data, remove old.

## Qdrant `project_id` Filtering

**Decision**: Add `project_id` as a keyword payload field in Qdrant,
alongside `org_id`. All search queries add a `project_id` filter to the
`must` clause.

**Updated filter structure**:
```typescript
const filter = {
  must: [
    { key: 'org_id', match: { value: orgId } },
    { key: 'project_id', match: { value: projectId } },
    ...(type ? [{ key: 'type', match: { value: type } }] : []),
  ],
};
```

**Cross-project search (`--all-projects`)**:
```typescript
// When all_projects = true, use should clause for project_ids
const projectFilter = allProjects
  ? { should: memberProjectIds.map(id => ({ key: 'project_id', match: { value: id } })) }
  : { must: [{ key: 'project_id', match: { value: activeProjectId } }] };
```

**Payload index**: Create `project_id` keyword index on collection
initialization:
```typescript
await qdrant.createPayloadIndex(COLLECTION_NAME, {
  field_name: 'project_id',
  field_schema: 'keyword',
});
```

**Rationale**: Qdrant payload filtering is the standard approach for
tenant isolation. Adding `project_id` as a second-level filter within
the org is cheap (keyword index) and provides exact project scoping.

**Alternatives considered**:
- **Separate Qdrant collections per project**: Simpler isolation but
  cross-project search requires querying N collections. Collection
  management overhead grows with project count. Single collection with
  payload filter is the standard multi-tenant pattern.
- **Qdrant groups/shards**: Overkill for this scale. Payload filtering
  is adequate for <10K decisions per project.

## JWT Claims: Adding `project_id`

**Decision**: The `exchange-token` Edge Function now accepts an optional
`project_id` parameter. When provided, the minted JWT includes a
`project_id` claim. RLS policies check both `org_id` and `project_id`.

**Updated JWT Claims**:
```json
{
  "sub": "<member_id>",
  "role": "authenticated",
  "exp": "<now + 3600>",
  "iat": "<now>",
  "iss": "teamind",
  "org_id": "<org_id>",
  "project_id": "<project_id>",
  "member_role": "admin|project_admin|project_member",
  "author_name": "<author_name>"
}
```

**RLS policy update**:
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

-- Decisions: project-scoped isolation
CREATE POLICY decisions_project_isolation ON decisions
  FOR ALL
  USING (
    org_id::text = effective_org_id()
    AND project_id::text = effective_project_id()
  )
  WITH CHECK (
    org_id::text = effective_org_id()
    AND project_id::text = effective_project_id()
  );
```

**Exchange-token flow update**:
1. CLI sends `project_id` alongside the API key
2. Edge Function validates member has access to the project (via
   `project_members` table)
3. If no access: 403 `{ "error": "no_project_access" }`
4. If access: mint JWT with `project_id` claim
5. When `project_id` is omitted (legacy clients): JWT has no
   `project_id` claim, legacy RLS policies still work

**Rationale**: Project-scoped JWTs provide native Supabase RLS
enforcement at the project level. No application-level filtering
needed. The database itself enforces isolation.

**Alternatives considered**:
- **Application-level project filtering only**: Works but violates the
  spirit of Constitution X (Identity-First Access Control). If a bug
  skips the filter, data leaks. Database-level enforcement is defense
  in depth.
- **Separate JWT per project**: Unnecessary complexity. A single JWT
  with project_id claim is sufficient. When the user switches projects,
  they get a new JWT.

## Realtime Subscription Scoping

**Decision**: Change the Realtime subscription filter from `org_id` to
`org_id` + `project_id`. The channel name changes from `org:${orgId}`
to `project:${projectId}`.

**Updated subscription**:
```typescript
supabase
  .channel(`project:${projectId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'decisions',
    filter: `project_id=eq.${projectId}`,
  }, (payload) => { /* ... */ })
  .subscribe()
```

**Rationale**: Project-scoped subscription ensures Dev B on "backend-api"
does not receive notifications for "frontend-app" decisions. Aligns
with Constitution XI and FR-006/FR-010.

**Fallback**: If `project_id` filter is not supported (e.g., during
migration before all decisions have project_id), fall back to org_id
filter with client-side project_id check.

## RBAC Extension

**Decision**: Three-level RBAC as specified:
- **org admin**: Full access to all projects. Can create projects,
  manage org settings, add members to any project.
- **project admin**: Full access within one project. Can add/remove
  project members, rotate project invite code.
- **project member**: Store, search, lifecycle operations within
  assigned projects.

**Storage**: The existing `members.role` column stays as `admin | member`
for org-level role. A new `project_members.role` column stores
`project_admin | project_member` for project-level role.

**Permission resolution**:
```
if (members.role === 'admin') → org admin → full access everywhere
else → check project_members for specific project access
```

**Rationale**: Separating org role from project role allows flexible
access patterns. A senior architect can be a regular org member but a
project_admin on specific projects.
