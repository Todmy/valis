# Feature Specification: Registration API

**Feature Branch**: `005-registration-api`
**Created**: 2026-03-24
**Status**: Draft
**Input**: Replace .hosted-env / hardcoded credentials with a public registration Edge Function

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-Time Hosted Setup (Priority: P1)

A new user installs Valis and runs `valis init`. They choose
"Hosted" mode. Instead of needing a `.hosted-env` file or environment
variables, the CLI calls a public registration endpoint. The endpoint
creates an org, a default project, and a member — then returns only
the per-member API key and public endpoint URLs. The service_role key
never leaves the server. The user only enters org name, project name,
and their name.

**Why this priority**: This is the core onboarding flow. Every hosted
user goes through it. Without this, users need to manually create
`.hosted-env` files — a terrible first experience.

**Independent Test**: Fresh machine, no config. Run `valis init` →
choose Hosted → enter org name + name → org created, project created,
IDE configured, brain seeded. No credentials needed from the user.

**Acceptance Scenarios**:

1. **Given** a fresh machine with no Valis config, **When** the
   user runs `valis init` and chooses Hosted, **Then** they only
   enter org name, project name, and their name — no URLs or keys.
2. **Given** the registration call succeeds, **When** config is
   saved, **Then** `~/.valis/config.json` contains only the
   per-member API key, Supabase URL (public), and Qdrant URL
   (public). No service_role key is stored locally.
3. **Given** the saved config, **When** the CLI makes subsequent
   calls (store, search), **Then** it uses the per-member API key
   via the exchange-token flow (existing Phase 2 JWT auth).
4. **Given** registration fails (network error), **When** the error
   occurs, **Then** a clear message is shown with retry instructions.
5. **Given** an existing org name that's taken, **When** registration
   is attempted, **Then** the user sees "Organization name already
   taken" and can choose a different name.

---

### User Story 2 - Join Existing Project (Priority: P2)

A teammate receives an invite code and runs `valis init --join
ABCD-1234`. The CLI calls a public join endpoint that validates the
invite, creates a member, and returns credentials. No `.hosted-env`
needed. The invite code is project-scoped (from 004-multi-project).

**Why this priority**: Joining is the second most common flow after
creation. It must be equally frictionless.

**Independent Test**: Create org + project (US1). Get invite code.
On a different machine, run `valis init --join <code>` → joined,
configured, no credential files needed.

**Acceptance Scenarios**:

1. **Given** a valid project invite code, **When** `valis init
   --join <code>` runs, **Then** the CLI calls the join endpoint
   and receives per-member credentials without needing any config.
2. **Given** an invalid invite code, **When** join is attempted,
   **Then** "Invalid invite code" error is shown.
3. **Given** successful join, **When** config is saved, **Then**
   only per-member API key + public URLs are stored locally.
4. **Given** the user is already in the org but not the project,
   **When** they join via invite, **Then** they are added to the
   project (not duplicated in the org).

---

### User Story 3 - Community Mode Unchanged (Priority: P3)

Users who choose Community mode continue to provide their own
Supabase URL, service_role key, and Qdrant credentials. The
registration API is not involved. This path remains for self-hosted
deployments.

**Why this priority**: Community mode must not break. Enterprise
users self-host and need full control.

**Independent Test**: Run `valis init` → choose Community → enter
credentials manually → works exactly as before.

**Acceptance Scenarios**:

1. **Given** Community mode selected, **When** init runs, **Then**
   the user is prompted for Supabase URL, Service Role Key, Qdrant
   URL, Qdrant API Key — same as current behavior.
2. **Given** Community mode config saved, **When** subsequent calls
   run, **Then** service_role key is used (legacy path preserved).

---

### User Story 4 - Remove .hosted-env Dependency (Priority: P4)

After this feature ships, the `.hosted-env` file and
`VALIS_HOSTED_*` environment variables are no longer needed for
hosted mode. The `loadHostedEnv()` function is removed from init.ts.
Hosted credentials come from the registration API response, not from
local files.

**Why this priority**: Cleanup — remove the anti-pattern of
distributing credentials via files.

**Independent Test**: Delete `~/.valis/.hosted-env`. Run
`valis init` → Hosted mode works without it.

**Acceptance Scenarios**:

1. **Given** no `.hosted-env` file exists, **When** hosted init
   runs, **Then** it succeeds via the registration API.
2. **Given** `VALIS_HOSTED_*` env vars are not set, **When**
   hosted init runs, **Then** it succeeds via the registration API.
3. **Given** the codebase, **When** reviewed, **Then** no service
   role keys appear in any client-side code or config files.

---

### Edge Cases

- What happens when the registration API is down? CLI shows
  "Valis registration service is currently unavailable. Try again
  later or use Community mode for self-hosted setup."
- What happens when rate limiting kicks in? The registration endpoint
  has rate limiting (e.g., 10 orgs per IP per hour). CLI shows
  "Too many registrations. Try again later."
- What happens when an org name contains special characters? Names
  are validated server-side (1-100 chars, alphanumeric + spaces +
  hyphens). Invalid names rejected with clear error.
- What happens when the user's machine has no internet? Same as
  current — offline queue for stores, empty results for search.
  But init requires network (registration is an online-only operation).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a public Edge Function
  (`/functions/v1/register`) that creates an org, default project,
  and first member in a single call. No authentication required
  (public endpoint).
- **FR-002**: The registration response MUST return only: member
  API key (`tmm_` prefix), Supabase URL (public, not service_role),
  Qdrant URL (public), org_id, project_id, invite_code. It MUST
  NOT return any service_role or admin keys.
- **FR-003**: The CLI hosted mode MUST use the registration API
  instead of loading credentials from `.hosted-env` or environment
  variables.
- **FR-004**: The CLI MUST store only per-member credentials in
  the local config. No service_role key on client machines.
- **FR-005**: A public join endpoint (`/functions/v1/join-public`)
  MUST accept an invite code and author name, create a member, and
  return per-member credentials.
- **FR-006**: Community mode MUST remain unchanged — users provide
  their own credentials including service_role key.
- **FR-007**: The registration endpoint MUST have rate limiting to
  prevent abuse (max 10 orgs per IP per hour).
- **FR-008**: All subsequent CLI operations (store, search, lifecycle)
  MUST work with per-member API key only (no service_role key needed
  on the client).

### Key Entities

- **Registration** is not a persistent entity — it's a single API
  call that creates Organization + Project + Member atomically.
- No new entities needed — uses existing org, project, member tables.

## Assumptions

- The Supabase URL and Qdrant URL for hosted mode are fixed (known
  at build time) and can be hardcoded as public constants in the CLI.
  Only the API key is dynamic (per-member).
- The registration Edge Function uses service_role key internally
  (server-side trusted code) but never exposes it in responses.
- Rate limiting is implemented via IP-based tracking in the Edge
  Function (using a simple counter in the database or in-memory).
- The exchange-token Edge Function already accepts per-member API
  keys and returns JWTs — this flow is reused as-is.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user completes `valis init` (Hosted) in under
  60 seconds without needing any credentials, config files, or
  environment variables.
- **SC-002**: Zero service_role keys exist on any client machine
  after hosted init.
- **SC-003**: The registration endpoint responds in under 2 seconds.
- **SC-004**: Existing Community mode users are unaffected — their
  flow works identically to before.
- **SC-005**: All 387 existing tests continue to pass after the
  change (backward compatibility).
