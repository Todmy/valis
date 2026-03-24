# Feature Specification: Multi-Project Support

**Feature Branch**: `004-multi-project`
**Created**: 2026-03-24
**Status**: Draft
**Input**: Architecture change — organizations contain multiple projects with independent knowledge bases

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Project Within Org (Priority: P1)

A Tech Lead has already initialized Teamind for their org "Krukit."
They run `teamind init` in their frontend repo and create a project
called "frontend-app." Later, they `cd` to their backend repo, run
`teamind init` again, and create a second project "backend-api" in
the same org. Each project has its own decision brain. Decisions
stored in frontend-app are not visible when searching from backend-api
unless explicitly requested.

**Why this priority**: Without projects, all decisions from all repos
pile into one flat brain. A 50-person team with 10 repos gets noise
from irrelevant decisions on every search. Projects are the
fundamental unit of organization.

**Independent Test**: Create org, create project A, store a decision.
Create project B in same org, search — decision from A should NOT
appear. Switch to A, search — decision appears.

**Acceptance Scenarios**:

1. **Given** an existing org, **When** a member runs `teamind init`
   in a new directory, **Then** they can create a new project or
   select an existing one within their org.
2. **Given** an org with 0 projects, **When** the first `teamind init`
   runs, **Then** a project is created automatically (named after the
   directory or prompted).
3. **Given** an org with existing projects, **When** `teamind init`
   runs, **Then** the user sees a list of existing projects and can
   choose one or create new.
4. **Given** a project created, **When** the config is saved, **Then**
   `project_id` and `project_name` are stored in
   `~/.teamind/config.json` alongside `org_id`.
5. **Given** two projects in the same org, **When** decisions are
   stored in project A, **Then** searching from project B returns
   zero results by default.

---

### User Story 2 - Per-Project Member Access (Priority: P2)

An org admin invites Dev A to "frontend-app" and Dev B to
"backend-api." Dev A can store and search decisions in frontend-app
but cannot see backend-api decisions. Dev B has the reverse access.
A senior architect (Dev C) is added to both projects and can search
across both.

**Why this priority**: Not every team member should see every
project's decisions. Backend security decisions should not leak to
external contractors working on the frontend. Per-project access is
a security requirement for enterprise adoption.

**Independent Test**: Add member to project A only. Verify they
can store/search in A. Verify they get 403 when trying to access
project B.

**Acceptance Scenarios**:

1. **Given** a new project, **When** a member is added via invite,
   **Then** they are granted access to that specific project (not
   all projects in the org).
2. **Given** a member with access to project A only, **When** they
   call `teamind_search` (which is scoped to their active project),
   **Then** they see only project A decisions.
3. **Given** a member with access to project A only, **When** they
   attempt to store a decision in project B, **Then** they receive
   a 403 "no access to this project" error.
4. **Given** a member added to projects A and B, **When** they search
   with `--all-projects`, **Then** they see decisions from both A
   and B (but not from project C they don't have access to).
5. **Given** an org admin, **When** they manage projects, **Then**
   they can add/remove members from any project.
6. **Given** `teamind init --join <invite-code>`, **When** a new
   member joins, **Then** the invite code is scoped to a specific
   project (not the entire org).

---

### User Story 3 - Project-Scoped Search & Context (Priority: P3)

A developer working on the frontend asks their agent "what did we
decide about authentication?" The agent searches and finds only
frontend-relevant auth decisions (e.g., "Use NextAuth for frontend
sessions"). Backend auth decisions (e.g., "Use JWT for API auth")
are in a different project and don't appear — reducing noise and
improving relevance.

If the developer needs the full picture, they can explicitly search
across all their projects.

**Why this priority**: Search relevance is the core product value.
Project scoping dramatically reduces noise for large teams. Without
it, a search for "database" returns 50 results from 10 different
repos — unusable.

**Independent Test**: Store "Use NextAuth" in project A and "Use JWT
for API" in project B. Search "authentication" from project A — only
NextAuth appears. Search with `--all-projects` — both appear.

**Acceptance Scenarios**:

1. **Given** active project A, **When** `teamind_search` is called,
   **Then** results are filtered to project A by default.
2. **Given** active project A, **When** `teamind_context` is called
   with a task description, **Then** only project A decisions are
   loaded as context.
3. **Given** a member with access to A and B, **When** they search
   with `all_projects: true` parameter, **Then** results from both
   projects are returned, labeled with project name.
4. **Given** a member with access to A only, **When** they search
   with `all_projects: true`, **Then** they still only see A
   (access control enforced even in cross-project mode).
5. **Given** the CLI `teamind search`, **When** `--all-projects`
   flag is used, **Then** results show `[project-name]` prefix.

---

### User Story 4 - Project-Scoped Push Notifications (Priority: P4)

Dev A stores a decision in "frontend-app." Dev B, working on the
same frontend project on a different machine, receives a push
notification. Dev C, working on "backend-api," does NOT receive the
notification — it's not their project.

**Why this priority**: Without project scoping, every decision in a
50-person org triggers notifications for everyone. This creates
notification fatigue and developers disable push entirely. Project
scoping keeps push useful.

**Independent Test**: Two devs on project A, one dev on project B.
Dev on A stores decision. Other dev on A gets push. Dev on B gets
nothing.

**Acceptance Scenarios**:

1. **Given** Dev A and Dev B on project "frontend-app", **When**
   Dev A stores a decision, **Then** Dev B receives a push
   notification within 5 seconds.
2. **Given** Dev C on project "backend-api", **When** Dev A stores
   a decision in "frontend-app", **Then** Dev C receives nothing.
3. **Given** a contradiction detected in project A, **When** the
   notification fires, **Then** only project A members see it.
4. **Given** Realtime subscription, **When** `teamind serve` starts,
   **Then** it subscribes to the active project's channel (not the
   entire org).

---

### User Story 5 - Switch Between Projects (Priority: P5)

A developer works on both frontend and backend. In the morning they
work on frontend — they `cd` to the frontend repo where Teamind is
configured for "frontend-app." In the afternoon they switch to the
backend repo — Teamind automatically uses the "backend-api" project
config. No manual switching needed.

If they need to switch within the same directory, `teamind switch
--project <name>` changes the active project.

**Why this priority**: Developers work on multiple repos daily.
Project switching must be frictionless — ideally automatic based on
working directory.

**Independent Test**: Init project A in `/frontend`, init project B
in `/backend`. `cd /frontend && teamind status` shows project A.
`cd /backend && teamind status` shows project B.

**Acceptance Scenarios**:

1. **Given** project A configured in `/frontend` and project B in
   `/backend`, **When** the developer runs `teamind status` from
   `/frontend`, **Then** it shows project A as active.
2. **Given** a developer in a directory with no project config,
   **When** they run `teamind status`, **Then** they see "No project
   configured. Run `teamind init` to set up."
3. **Given** `teamind switch --project backend-api`, **When** it
   runs, **Then** the active project changes and config is updated.
4. **Given** multiple projects configured on the same machine,
   **When** `teamind init` runs in a new directory, **Then** it
   detects the org from global config and asks to create/select a
   project (no need to re-enter credentials).

---

### User Story 6 - Migrate Existing Decisions to Projects (Priority: P6)

Existing Teamind installations have decisions without a `project_id`
(they were created before multi-project support). When the user
upgrades, these decisions MUST be migrated to a default project.
The migration is automatic and non-destructive.

**Why this priority**: Backward compatibility is a constitution
requirement. Existing users must not lose data or have broken
installations after the upgrade.

**Independent Test**: Install old version, store decisions. Upgrade
to new version. Verify all decisions are now in a "default" project.
Verify search still works.

**Acceptance Scenarios**:

1. **Given** existing decisions without `project_id`, **When** the
   migration runs, **Then** a "default" project is created and all
   existing decisions are assigned to it.
2. **Given** an existing config without `project_id`, **When**
   `teamind init` runs after upgrade, **Then** it detects the legacy
   config and offers to migrate to the new project structure.
3. **Given** migration complete, **When** search and store run,
   **Then** they work exactly as before (backward compatible).
4. **Given** migration, **When** it completes, **Then** an audit
   entry records the migration action.

---

### Edge Cases

- What happens when a member is removed from a project but has
  pending offline decisions? The queue flush fails with a warning.
  Decisions are lost (same as key revocation behavior).
- What happens when a project is deleted? Decisions are preserved
  but marked as belonging to a deleted project. They become
  inaccessible via search but remain in the database for compliance.
- What happens when the same decision is relevant to multiple
  projects? It must be stored separately in each project. There is
  no "shared decision" concept — projects are fully isolated.
- What happens when an org has only one project? Everything works
  the same — the project layer is always present, even for single-
  project orgs.
- What happens when `teamind init --join` is used with a project
  invite code but the member is already in the org? They are added
  to the new project without creating a duplicate org membership.
- What happens when searching with `--all-projects` across 10
  projects? Results are merged, deduplicated by content hash,
  labeled with project name, and reranked by the composite score.
  Limit applies to the merged result set.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support multiple projects within a single
  organization. Each project is an independent knowledge base.
- **FR-002**: Every decision MUST belong to exactly one project via
  `project_id`. No decision may exist without a project.
- **FR-003**: Members MUST be granted access to specific projects.
  Org membership alone does NOT grant access to any project.
- **FR-004**: `teamind_search` and `teamind_context` MUST filter by
  the active project by default.
- **FR-005**: Cross-project search MUST be available via an explicit
  `all_projects` parameter or `--all-projects` CLI flag, but MUST
  respect per-project access control.
- **FR-006**: Cross-session push notifications MUST be scoped to the
  active project, not the entire org.
- **FR-007**: `teamind init` MUST support creating a new project or
  selecting an existing one. The active project MUST be stored in
  the local config.
- **FR-008**: Invite codes MUST be project-scoped (not org-scoped).
  Joining via invite grants access to a specific project.
- **FR-009**: JWT claims MUST include `project_id` alongside
  `org_id` for project-scoped RLS enforcement.
- **FR-010**: Realtime subscriptions MUST filter by `project_id`
  (not just `org_id`).
- **FR-011**: Existing decisions without `project_id` MUST be
  automatically migrated to a "default" project on upgrade.
- **FR-012**: Project config MUST be per-directory — different
  working directories can be configured for different projects.
- **FR-013**: RBAC MUST support three levels: org admin (all
  projects), project admin (one project), project member (one
  project, limited operations).
- **FR-014**: All Edge Functions MUST validate `project_id` from
  JWT claims and reject cross-project operations.
- **FR-015**: Dashboard, contradictions, patterns, and cleanup
  MUST be project-scoped by default.

### Key Entities

- **Project**: New entity. Has id (UUID), org_id (FK), name (text),
  created_at. One org has many projects. Every decision belongs to
  one project.
- **ProjectMember**: New entity. Links member to project with a role
  (project_admin or project_member). A member can be in multiple
  projects.
- **Decision** (modified): `project_id` becomes a required FK to
  projects table (currently nullable text field).
- **InviteCode** (modified): Invite codes become project-scoped.
  A project has its own invite code separate from the org.

## Assumptions

- Per-directory config is stored in a project-level config file
  (e.g., `.teamind.json` in the project root or a mapping in
  `~/.teamind/projects.json`).
- The Qdrant `decisions` collection adds `project_id` as a payload
  filter field alongside `org_id`.
- Existing `org_id` filtering in all queries is replaced with
  `org_id` + `project_id` filtering.
- The web dashboard is project-scoped: user selects a project after
  login.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A decision stored in project A is NOT visible when
  searching from project B — verified with zero cross-project
  leakage across 3+ test projects.
- **SC-002**: Cross-project search with `--all-projects` returns
  results from all projects the member has access to, and zero
  results from projects they don't.
- **SC-003**: Push notifications from project A are received only
  by project A members — zero cross-project notification leakage.
- **SC-004**: Existing installations upgrade seamlessly — all
  pre-existing decisions are migrated to a default project with
  zero data loss.
- **SC-005**: `teamind init` in a new directory takes under 30
  seconds when the org already exists (project creation/selection
  only, no credential re-entry).
- **SC-006**: Per-directory project switching is automatic — running
  `teamind status` in different repos shows the correct project.
- **SC-007**: All 255 existing tests continue to pass after the
  multi-project migration (backward compatibility).
