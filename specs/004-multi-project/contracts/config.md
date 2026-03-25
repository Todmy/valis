# Config Contract: Multi-Project Support

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-24

## Overview

Multi-project support splits config into two tiers:

1. **Global config** (`~/.valis/config.json`): Org credentials and
   cloud infrastructure settings. Shared across all projects. Contains
   secrets — stored with `0600` permissions. NOT committed to version
   control.

2. **Per-directory config** (`.valis.json`): Project identity only.
   Contains no secrets. Lives in the project/repo root. SHOULD be
   committed to version control so all team members on the same repo
   automatically use the correct project.

## Per-Directory Config: `.valis.json`

**Location**: Project root directory (same level as `.git/`).

**Schema**:

```typescript
interface ProjectConfig {
  /** UUID of the project in Valis. */
  project_id: string;
  /** Human-readable project name. */
  project_name: string;
}
```

**Example**:

```json
{
  "project_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "project_name": "frontend-app"
}
```

**Properties**:
- File permissions: default (readable by all — no secrets)
- Encoding: UTF-8 JSON
- Max size: ~200 bytes
- Should be added to `.gitignore`: NO (commit to share with team)

## Global Config: `~/.valis/config.json`

**Location**: `~/.valis/config.json` (unchanged from MVP).

**Schema** (updated `ValisConfig`):

```typescript
interface ValisConfig {
  org_id: string;
  org_name: string;
  api_key: string;
  invite_code: string;          // Legacy — kept for backward compat
  author_name: string;
  supabase_url: string;
  supabase_service_role_key: string;
  qdrant_url: string;
  qdrant_api_key: string;
  configured_ides: string[];
  created_at: string;
  auth_mode?: 'legacy' | 'jwt';
  member_api_key?: string | null;
  member_id?: string | null;
}
```

**Changes from Phase 2/3**: None. The global config type is unchanged.
The `project_id` field that was previously optional on some types is
removed from global config — it now lives in `.valis.json`.

**Properties**:
- File permissions: `0600` (owner read/write only)
- Directory permissions: `0700`
- Encoding: UTF-8 JSON
- Should be added to `.gitignore`: N/A (lives in `~/.valis/`, not
  in any repo)

## Resolution Algorithm

The CLI resolves the effective config by merging global and per-directory
configs.

### `resolveConfig()` function

```typescript
interface ResolvedConfig {
  /** Global org-level config. Null if not configured. */
  global: ValisConfig | null;
  /** Per-directory project config. Null if no .valis.json found. */
  project: ProjectConfig | null;
}

async function resolveConfig(): Promise<ResolvedConfig> {
  // 1. Load global config
  const global = await loadGlobalConfig();  // ~/.valis/config.json

  // 2. Walk up from cwd to find .valis.json
  const project = await findProjectConfig(process.cwd());

  return { global, project };
}
```

### `findProjectConfig()` — walk-up algorithm

```typescript
async function findProjectConfig(startDir: string): Promise<ProjectConfig | null> {
  let dir = startDir;
  const root = parse(dir).root;  // '/' on Unix, 'C:\' on Windows

  while (true) {
    const configPath = join(dir, '.valis.json');
    try {
      const data = await readFile(configPath, 'utf-8');
      return JSON.parse(data) as ProjectConfig;
    } catch {
      // File not found — walk up
    }

    const parent = dirname(dir);
    if (parent === dir || dir === root) {
      // Reached filesystem root — no .valis.json found
      return null;
    }
    dir = parent;
  }
}
```

**Walk-up behavior**:
- Starts at `process.cwd()`
- Checks each directory for `.valis.json`
- Stops at filesystem root
- First match wins (closest to cwd)
- Returns `null` if no `.valis.json` found anywhere

### Resolution states

| Global config | `.valis.json` | State | CLI behavior |
|:---:|:---:|:---:|---|
| present | present | **Ready** | All operations work, project-scoped |
| present | missing | **No project** | `valis status` shows "No project. Run `valis init`." Org-level commands (admin) still work. |
| missing | present | **No org** | `valis status` shows "Run `valis init` to configure credentials." |
| missing | missing | **Unconfigured** | `valis status` shows "Run `valis init` to get started." |

## `valis init` Flow (updated)

### Case 1: Fresh install (no global config)

```
1. Choose mode: Hosted / Community
2. Create org or join via invite
   - If joining: call join-project (not join-org)
   - If creating: create org, then create first project
3. Save global config (~/.valis/config.json)
4. Prompt for project name (default: current directory name)
5. Call create-project Edge Function
6. Save .valis.json in cwd
7. Configure IDEs, seed brain
```

### Case 2: Org exists, new directory (global config present, no .valis.json)

```
1. Detect existing global config
2. Show: "Org: Krukit (already configured)"
3. List existing projects: "Select a project or create new"
   a. If projects exist: show list with decision counts
   b. User selects existing or types new name
4. If new: call create-project Edge Function
5. Save .valis.json in cwd
6. Skip org setup, credential entry, and IDE detection
   (IDEs are already configured from initial init)
```

### Case 3: `valis init --join <invite-code>`

```
1. Call join-project with invite code
2. Receive org + project metadata
3. If global config missing: save global config
4. If global config exists (same org): skip
5. If global config exists (different org): warn and confirm
6. Save .valis.json in cwd with returned project_id/name
7. Configure IDEs if not already configured
```

### Case 4: Reconfigure (both configs exist)

```
1. Show current: "Org: Krukit, Project: frontend-app"
2. Options:
   a. Switch project (list existing + create new)
   b. Reconfigure org (full reset)
   c. Cancel
3. If switch project:
   - Update .valis.json only
   - Global config unchanged
```

## `valis switch` Command (new)

```
valis switch --project <name-or-id>
```

**Behavior**:
1. Load global config (required)
2. List member's projects via `list_member_projects` RPC
3. Find matching project by name or ID
4. Update `.valis.json` in cwd with new project_id/name
5. Print confirmation

**Flags**:
- `--project <name>`: Switch to named project
- (no flags): Interactive — show list and prompt for selection

## `valis status` Output (updated)

```
Valis Status
  Org:      Krukit
  Project:  frontend-app (active)
  Author:   Olena
  Auth:     jwt (per-member)
  Cloud:    OK (Supabase + Qdrant)
  Realtime: connected (project: frontend-app)
  Brain:    42 decisions in this project
```

When no project is configured:

```
Valis Status
  Org:      Krukit
  Project:  (not configured)
  Author:   Olena

  Run `valis init` in your project directory to select a project.
```

## `.gitignore` Recommendation

During `valis init`, the CLI does NOT add `.valis.json` to
`.gitignore` because it should be shared with the team. However, the
global config directory `~/.valis/` is never inside a repo, so no
gitignore entry is needed for it.

If the user has sensitive overrides, they can create
`.valis.local.json` (not read by Valis — reserved for future use).

## Config Validation

The `resolveConfig()` function validates both configs on load:

```typescript
// Global config validation
const globalSchema = z.object({
  org_id: z.string().uuid(),
  org_name: z.string().min(1),
  api_key: z.string().min(1),
  supabase_url: z.string().url(),
  // ... (existing validation)
});

// Project config validation
const projectSchema = z.object({
  project_id: z.string().uuid(),
  project_name: z.string().min(1).max(100),
});
```

Invalid configs produce a clear error:
```
Error: Invalid .valis.json — project_id must be a valid UUID.
  Fix the file at /path/to/.valis.json or run `valis init` to reconfigure.
```

## Migration: Existing Configs

Existing installations have a global config but no `.valis.json`.
When the upgraded CLI detects this state:

1. All commands that require a project (store, search, serve) print:
   ```
   No project configured for this directory.
   Run `valis init` to select or create a project.
   ```
2. `valis init` detects the existing org, creates a default project
   (if not already created by migration 004), and writes `.valis.json`.
3. The migration is interactive — no silent automatic writes to the
   user's working directory.
