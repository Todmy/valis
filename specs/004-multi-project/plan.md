# Implementation Plan: Multi-Project Support

**Branch**: `004-multi-project` | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-multi-project/spec.md`

## Summary

Add multi-project support to Teamind so that organizations can maintain
independent knowledge bases per codebase (e.g., "frontend-app" and
"backend-api" within the same org). Decisions are scoped to projects,
search is project-filtered by default, push notifications are
project-scoped, and per-project access control ensures members only see
decisions relevant to their work. A two-tier config model (global
`~/.teamind/config.json` for org credentials + per-directory
`.teamind.json` for project identity) enables automatic project
switching when developers `cd` between repos.

Extends Phase 3 (Search Intelligence & Growth) with migration 004,
two new Postgres tables (`projects`, `project_members`), two new Edge
Functions (`create-project`, `join-project`), modifications to all
existing queries/subscriptions to include `project_id`, and a data
migration that assigns all existing decisions to a default project per
org.

## Technical Context

**Language/Version**: TypeScript (ES2022, NodeNext module resolution), Node.js 20+
**Edge Functions Runtime**: Deno (Supabase Edge Functions). New functions: create-project, join-project. Modified: exchange-token, change-status, rotate-key.
**Primary Dependencies**: Existing deps (no new dependencies required)
**Storage**: Supabase Postgres (migration 004: projects + project_members tables, altered decisions/contradictions/audit_entries) + Qdrant Cloud (project_id payload field + index) + Supabase Realtime (project-scoped subscriptions)
**Auth Model**: JWT claims extended with `project_id` and `project_role`. Per-member keys unchanged. exchange-token validates project access before minting JWT.
**Realtime**: Subscription channel changes from `org:${orgId}` to `project:${projectId}`. Filter changes from `org_id=eq.${orgId}` to `project_id=eq.${projectId}`.
**Config**: Two-tier — global `~/.teamind/config.json` (org creds, unchanged) + per-directory `.teamind.json` (project_id, project_name). Walk-up resolution from cwd.
**Testing**: vitest with mocked Supabase/Qdrant clients. Config resolution tests with temp directories. Migration tests with fixture data.
**Target Platform**: macOS ARM64/Intel, Linux x64 (unchanged)
**Project Type**: CLI + MCP server (extended)
**Performance Goals**: <500ms project switch, <30s init with existing org, <5s cross-session push (project-scoped)
**Constraints**: Zero native deps, offline-capable, backward compatible with Phases 1-3, additive-only migration (with controlled type change for project_id via deprecation cycle)
**Scale/Scope**: Teams 3-50 devs, 1-20 projects per org, 50-5K decisions per project, 2 new Edge Functions, 2 modified Edge Functions, modified MCP tools (search, context, store), new CLI command (switch), modified CLI commands (init, status, serve, dashboard)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Cloud-First | PASS | Projects, project_members, and project-scoped queries are all cloud-native. No local-only project management. |
| II | Minimally Invasive | PASS | Same MCP + channel integration. No new IDE interception. `.teamind.json` is a passive config file read on demand. |
| III | Non-Blocking | PASS | Missing `.teamind.json` degrades to "no project" message, not an error. Missing project_id in Qdrant falls back to org-level search. Realtime failure is silent. |
| IV | No LLM Dependency | PASS | No LLM calls. Project creation, membership, and filtering are all deterministic operations. |
| V | Zero Native Dependencies | PASS | No new dependencies required. Config resolution uses Node.js built-in `fs` and `path`. |
| VI | Auto-Capture by Default | PASS | Unchanged. Auto-capture layers now include `project_id` from resolved config. File watcher and stop hook read `.teamind.json` automatically. |
| VII | Dual Storage | PASS | Every write includes `project_id` in both Postgres and Qdrant. Qdrant payload gets `project_id` field + keyword index. |
| VIII | Push + Pull | PASS | Push scoped to project channel. Pull still works without push. Cross-session push filters by project_id. |
| IX | Decision Lifecycle | PASS | Unchanged. Status transitions, relationships, contradiction detection all work within project scope. Cross-project contradictions are not possible (by design — projects are independent). |
| X | Identity-First Access | PASS | JWT includes `project_id` + `project_role`. RLS enforces project isolation at database level. Per-member keys unchanged. Audit trail includes project_id. |
| XI | Project-Scoped Isolation | PASS | This feature IS the implementation of Principle XI. Every requirement maps directly to a spec FR. Decisions scoped to project, per-project membership, project-scoped search/push, init selects project. |

**Security & Data Integrity**: Project-scoped RLS via `effective_project_id()` function. JWT includes `project_id` claim. Qdrant queries filter by `project_id`. Cross-project search uses org-level JWT (no project_id) with application-level access control via `project_members`. Per-directory `.teamind.json` contains no secrets.

**Development Workflow**: Migration 004 follows deprecation cycle for `project_id` type change (TEXT -> UUID FK): add new column, backfill, drop old. All existing tests must pass after migration. New tests for config resolution, project CRUD, project-scoped search, and migration.

## Project Structure

### Documentation (this feature)

```text
specs/004-multi-project/
├── plan.md              # This file
├── research.md          # Phase 0: Config resolution, invites, migration, Qdrant, JWT
├── data-model.md        # Phase 1: projects + project_members tables, altered schema
├── quickstart.md        # Phase 1: Validation checklist for all 6 user stories
├── contracts/
│   ├── edge-functions.md  # 2 new + 3 modified Edge Functions
│   └── config.md          # Two-tier config resolution contract
└── tasks.md             # Phase 2: /speckit.tasks output (not yet created)
```

### Source Code (repository root)

```text
packages/cli/src/
├── types.ts                    # Extended: Project, ProjectMember, ProjectConfig, ResolvedConfig
├── config/
│   ├── store.ts                # MODIFIED: add loadProjectConfig, findProjectConfig, resolveConfig
│   └── project.ts              # NEW: per-directory .teamind.json read/write/walk-up
├── cloud/
│   ├── supabase.ts             # MODIFIED: all queries add project_id parameter
│   ├── qdrant.ts               # MODIFIED: upsert adds project_id payload, search adds project_id filter
│   └── realtime.ts             # MODIFIED: subscribe to project channel (not org)
├── auth/
│   └── jwt.ts                  # MODIFIED: exchange-token sends project_id, cache per-project JWTs
├── mcp/
│   ├── server.ts               # MODIFIED: resolve project config before tool dispatch
│   └── tools/
│       ├── store.ts            # MODIFIED: include project_id in store calls
│       ├── search.ts           # MODIFIED: project-scoped search, --all-projects support
│       └── context.ts          # MODIFIED: project-scoped context loading
├── commands/
│   ├── init.ts                 # MODIFIED: two-tier init flow (org + project selection)
│   ├── serve.ts                # MODIFIED: subscribe to project channel
│   ├── status.ts               # MODIFIED: show active project from .teamind.json
│   ├── switch.ts               # NEW: teamind switch --project <name>
│   └── dashboard.ts            # MODIFIED: project-scoped dashboard stats
├── contradiction/
│   └── detect.ts               # MODIFIED: pass project_id to find_contradictions
├── ...                         # Remaining files unchanged

supabase/
├── migrations/
│   ├── 001_init.sql            # Unchanged (MVP)
│   ├── 002_retention.sql       # Unchanged (Phase 2)
│   ├── 003_search_growth.sql   # Unchanged (Phase 3)
│   └── 004_multi_project.sql   # NEW: projects, project_members, decision migration
├── functions/
│   ├── create-org/             # Unchanged
│   ├── join-org/               # DEPRECATED: kept for backward compat
│   ├── create-project/         # NEW: create project within org
│   ├── join-project/           # NEW: join via project invite code
│   ├── exchange-token/         # MODIFIED: accepts project_id, adds to JWT
│   ├── change-status/          # MODIFIED: validates project_id from JWT
│   ├── rotate-key/             # MODIFIED: supports project_invite_code rotation
│   └── revoke-member/          # Unchanged (org-level revocation)

packages/cli/test/
├── config/
│   ├── store.test.ts           # MODIFIED: test two-tier config resolution
│   └── project.test.ts         # NEW: per-directory config tests
├── cloud/
│   ├── supabase.test.ts        # MODIFIED: project-scoped query tests
│   ├── qdrant.test.ts          # MODIFIED: project_id filter tests
│   └── realtime.test.ts        # MODIFIED: project channel subscription tests
├── mcp/
│   ├── search.test.ts          # MODIFIED: project-scoped + all-projects tests
│   └── store.test.ts           # MODIFIED: project_id inclusion tests
├── commands/
│   ├── init.test.ts            # MODIFIED: two-tier init flow tests
│   └── switch.test.ts          # NEW: switch command tests
└── migration/
    └── default-project.test.ts # NEW: migration 004 validation tests
```

**Structure Decision**: Extends existing monorepo structure. One new
source file (`config/project.ts`) for per-directory config logic. One
new command (`commands/switch.ts`). One new migration file. Two new Edge
Functions. All other changes are modifications to existing files.

## Complexity Tracking

> No Constitution Check violations. All 11 principles pass.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `project_id` type change (TEXT -> UUID) | FK integrity required for project-scoped RLS and cascading deletes. TEXT field cannot enforce referential integrity. | Keeping TEXT and doing application-level validation was rejected because it violates defense-in-depth: a bug could store decisions with non-existent project_ids. The deprecation cycle (add new, migrate, drop old) follows constitution requirements. |
| Cross-project search bypasses project RLS | `--all-projects` needs to query across projects. JWT without `project_id` allows org-wide access. | Per-project JWT rotation (query each project separately) was rejected because it requires N API calls for N projects and N Qdrant queries. Single org-level query with application filtering is simpler and faster. Org-level RLS still prevents cross-org leakage. |
