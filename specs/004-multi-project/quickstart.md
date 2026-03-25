# Quickstart: Phase 4 Validation

## Prerequisites

- Valis Phase 3 installed and working (`valis status` shows OK)
- Supabase migration 004 applied
- Two machines/terminals with separate Valis sessions
- An existing org with decisions (to test migration)

## 1. Migrate Existing Decisions to Default Project (US6)

```bash
# Before migration: existing decisions have no project_id
valis status
# Expected: "Org: Krukit, Author: Olena"

# Apply migration 004 (via Supabase dashboard or CLI)
# Expected: default project created, all decisions assigned

# After migration: init prompts for project
valis init
# Expected: "Org: Krukit (already configured)"
# Shows: "1 project found: default (42 decisions)"
# Prompt: "Select a project or create new"
# Select: default
# Expected: .valis.json created with project_id

valis status
# Expected: "Org: Krukit, Project: default (active), Brain: 42 decisions"
```

## 2. Create Project Within Org (US1)

```bash
# In frontend repo directory:
cd ~/repos/frontend
valis init
# Expected: "Org: Krukit (already configured)"
# Prompt: "Project name (or select existing):"
# Type: frontend-app
# Expected: "Project 'frontend-app' created"
# Expected: .valis.json created

cat .valis.json
# Expected: { "project_id": "uuid", "project_name": "frontend-app" }

# In backend repo directory:
cd ~/repos/backend
valis init
# Expected: same org detected
# Type: backend-api
# Expected: "Project 'backend-api' created"

valis status
# Expected: "Org: Krukit, Project: backend-api (active)"
```

## 3. Project-Scoped Search & Context (US3)

```bash
# In frontend directory:
cd ~/repos/frontend

# Via MCP tool in IDE session:
# valis_store({ text: "Use NextAuth for frontend sessions", type: "decision", affects: ["auth"] })
# Expected: stored in frontend-app project

cd ~/repos/backend
# valis_store({ text: "Use JWT for API auth", type: "decision", affects: ["auth"] })
# Expected: stored in backend-api project

# Search from frontend:
cd ~/repos/frontend
valis search "authentication"
# Expected: ONLY "Use NextAuth for frontend sessions"
# Expected: "Use JWT for API auth" does NOT appear

# Cross-project search:
valis search "authentication" --all-projects
# Expected: Both results appear
# Expected: Results labeled [frontend-app] and [backend-api]

# Context from frontend:
# valis_context({ task: "implement login page" })
# Expected: Only frontend-app decisions loaded
```

## 4. Per-Project Member Access (US2)

```bash
# Admin creates project invite for frontend-app:
valis status
# Note the project invite code (shown during project creation)

# Dev A joins frontend-app:
# On Dev A's machine:
valis init --join ABCD-1234
# Expected: Joined "frontend-app" in org "Krukit"

# Dev A stores in frontend:
# valis_store({ text: "Use Tailwind CSS", type: "decision", affects: ["styling"] })
# Expected: stored successfully

# Dev A tries to access backend-api:
# (Dev A would need to init in a backend directory with backend's invite code)
# Without access: any store/search scoped to backend-api returns 403

# Dev C (architect) is added to both projects:
# valis init --join EFGH-5678  (backend invite code, in backend dir)
# valis init --join ABCD-1234  (frontend invite code, in frontend dir)
# Dev C can search --all-projects and see both
```

## 5. Project-Scoped Push Notifications (US4)

```bash
# Terminal A: cd ~/repos/frontend && valis serve
# Terminal B: cd ~/repos/frontend && valis serve (same project, different machine)
# Terminal C: cd ~/repos/backend && valis serve (different project)

# In Terminal A's IDE session:
# valis_store({ text: "Migrate to React Server Components", type: "decision", affects: ["architecture"] })

# Terminal B should receive push notification within 5 seconds:
# <channel source="valis" event="new_decision" author="Olena" type="decision" origin="remote">

# Terminal C should receive NOTHING (different project)
```

## 6. Switch Between Projects (US5)

```bash
# Automatic switching via directory:
cd ~/repos/frontend
valis status
# Expected: "Project: frontend-app (active)"

cd ~/repos/backend
valis status
# Expected: "Project: backend-api (active)"

# No .valis.json:
cd ~/repos/new-repo
valis status
# Expected: "No project configured. Run `valis init` to set up."

# Manual switch within same directory:
valis switch --project frontend-app
# Expected: .valis.json updated to frontend-app
valis status
# Expected: "Project: frontend-app (active)"
```

## Validation Checklist

### US1 — Create Project Within Org
- [ ] `valis init` in new directory detects existing org from global config
- [ ] Can create a new project (saves to .valis.json)
- [ ] Can select an existing project from the list
- [ ] First project created automatically when org has zero projects
- [ ] `.valis.json` contains only `project_id` and `project_name`
- [ ] Global `~/.valis/config.json` unchanged when adding project

### US2 — Per-Project Member Access
- [ ] `valis init --join <code>` resolves to specific project
- [ ] Member added to project_members with project_member role
- [ ] Member can store/search in assigned project
- [ ] Member gets 403 when accessing unassigned project
- [ ] Member in projects A and B can search --all-projects (sees both)
- [ ] Org admin can manage any project (implicit access)

### US3 — Project-Scoped Search & Context
- [ ] `valis_search` filters by active project by default
- [ ] `valis_context` loads only active project's decisions
- [ ] `--all-projects` flag returns results from all accessible projects
- [ ] Cross-project results labeled with `[project-name]` prefix
- [ ] Access control enforced even in cross-project mode
- [ ] Qdrant queries include `project_id` filter

### US4 — Project-Scoped Push Notifications
- [ ] Realtime subscribes to `project:{projectId}` channel
- [ ] Push from project A received only by project A members
- [ ] Push from project A NOT received by project B members
- [ ] Contradiction notifications project-scoped
- [ ] Realtime failure degrades gracefully (search still works)

### US5 — Switch Between Projects
- [ ] `cd` to directory with `.valis.json` auto-switches project
- [ ] `valis status` shows correct project per directory
- [ ] `valis switch --project <name>` updates `.valis.json`
- [ ] Directory with no `.valis.json` shows "No project configured"
- [ ] Nested repos: closest `.valis.json` wins

### US6 — Migrate Existing Decisions to Projects
- [ ] Migration 004 creates default project per org
- [ ] All existing decisions assigned to default project
- [ ] All existing members become project_members of default
- [ ] Org admins become project_admin of default
- [ ] Audit entry records the migration
- [ ] Search works exactly as before after migration
- [ ] All 255+ existing tests pass after migration (backward compat)
- [ ] Qdrant points without project_id still appear in default project searches
