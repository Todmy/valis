# Feature Specification: Device Authorization Login

**Feature Branch**: `007-device-auth-login`
**Created**: 2026-03-29
**Status**: Draft
**Input**: Browser-based Device Authorization Grant (RFC 8628) for `valis login`, with magic link email auth on dashboard, device code approval, and CLI polling.

## Clarifications

### Session 2026-03-29

- Q: How does the system link a dashboard auth email to a Valis member? → A: Add `email` column to `members` table. Match auth email → member.email on approval. Existing members will be recreated via fresh `valis init`.
- Q: What email sender is used for magic link emails? → A: Use default Supabase Auth sender for MVP. Custom SMTP domain (e.g. `noreply@krukit.co`) deferred to backlog.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — CLI Login from New Device (Priority: P1)

A developer installs Valis on a new machine. They run `valis login` in the terminal. The CLI opens their browser to a Valis dashboard page showing a short code. They confirm the code matches what they see in the terminal, click "Approve," and the CLI automatically receives their credentials. From that point, all `valis` commands work without further auth.

**Why this priority**: Without this, there's no way to authenticate on a new device. It's the entire reason for this feature.

**Independent Test**: Run `valis login` on a machine with no `~/.valis/` directory. Verify the browser opens, the code matches, clicking Approve completes the flow, and `valis status` works afterward.

**Acceptance Scenarios**:

1. **Given** a developer with an existing Valis account and no local credentials, **When** they run `valis login`, **Then** the CLI generates a device code, opens the browser to the approval page, and prints the code in the terminal.
2. **Given** the developer is already logged into the Valis dashboard in their browser, **When** the approval page loads, **Then** it shows the device code and an "Approve" button without requiring re-authentication.
3. **Given** the developer clicks "Approve" on the dashboard, **When** the CLI polls for authorization, **Then** it receives credentials, saves them locally, and prints a success message with the user's name and org.

---

### User Story 2 — Dashboard Email Login (Priority: P1)

A developer who is NOT logged into the Valis dashboard opens the device approval page. The dashboard redirects them to a login page where they enter their email address. They receive a magic link email, click it, and are authenticated on the dashboard. The dashboard then shows the device approval page where they can approve the CLI login.

**Why this priority**: Co-equal with Story 1. The device flow doesn't work unless the user can authenticate on the dashboard. Most first-time users on a new device won't have an active dashboard session.

**Independent Test**: Open the dashboard login page directly. Enter an email, receive the magic link, click it, and verify the user is authenticated and redirected correctly.

**Acceptance Scenarios**:

1. **Given** an unauthenticated user opens the device approval URL, **When** the page loads, **Then** they are redirected to the login page with a return URL pointing back to the approval page.
2. **Given** the user enters their email on the login page, **When** they submit, **Then** they see a confirmation message and receive a magic link email within 30 seconds.
3. **Given** the user clicks the magic link, **When** the browser opens, **Then** they are authenticated and redirected to the device approval page with the code pre-filled.

---

### User Story 3 — CLI Login Without Browser (SSH / Headless) (Priority: P2)

A developer working over SSH or on a headless server runs `valis login`. The CLI cannot open a browser. Instead, it prints a URL and the device code. The developer copies the URL to their phone or another computer's browser, logs in there, approves the code, and the CLI on the headless machine receives credentials.

**Why this priority**: Important for server/CI environments but less common than desktop use. Same backend infrastructure as P1 — the CLI just doesn't auto-open the browser.

**Independent Test**: Run `valis login` with `BROWSER=none` environment variable. Verify the URL and code are printed. Open the URL on a different device, approve, and verify the CLI receives credentials.

**Acceptance Scenarios**:

1. **Given** a developer on a headless machine, **When** they run `valis login`, **Then** the CLI prints the full verification URL and the human-readable code.
2. **Given** the developer opens the URL on a different device and approves, **When** the CLI polls for authorization, **Then** it receives credentials and completes login.

---

### User Story 4 — First Registration with Email (Priority: P2)

A brand-new user who has never used Valis runs `valis init` and chooses "Create new account." They enter their name and email. The system creates their account (org, project, member) and also creates a dashboard auth account linked to their email. From then on, they can use `valis login` on any device via email magic link.

**Why this priority**: Needed for the auth flow to be complete. Without linking registration to email, the user has no way to log in on another device.

**Independent Test**: Run `valis init` as a new user. Verify account creation, then on a different machine run `valis login`, authenticate via email, and verify access.

**Acceptance Scenarios**:

1. **Given** a new user runs `valis init` and chooses "Create new account", **When** they enter their name and email, **Then** the system creates their org, project, member (with email stored), and links their email to a dashboard auth account.
2. **Given** the user later runs `valis login` on another machine, **When** they approve via the dashboard (logging in with their email), **Then** they receive their existing credentials.

---

### User Story 5 — Device Code Expiry and Denial (Priority: P3)

A device code that is not approved within 15 minutes expires. A user can also explicitly deny a device code from the dashboard. In both cases, the CLI stops polling and shows an appropriate message.

**Why this priority**: Security boundary. Without expiry, orphaned codes accumulate. Without denial, a user can't reject a rogue login attempt.

**Independent Test**: Generate a device code, wait 15 minutes without approving, verify CLI shows "expired" message. Generate another code, click "Deny" on dashboard, verify CLI shows "denied" message.

**Acceptance Scenarios**:

1. **Given** a pending device code older than 15 minutes, **When** the CLI polls for authorization, **Then** it receives an "expired" response and stops polling with an error message.
2. **Given** a user clicks "Deny" on the dashboard for a device code, **When** the CLI polls, **Then** it receives a "denied" response and stops polling.
3. **Given** a user attempts to approve an expired code, **When** they click "Approve", **Then** the dashboard shows an error that the code has expired.

---

### Edge Cases

- What happens when the user has multiple orgs? The `members.email` column is UNIQUE globally — one email = one member record. The approval returns that member's org. Multi-org support (one email in multiple orgs) is out of scope for MVP.
- What happens if someone generates a code and someone else approves it? The approval is tied to the authenticated dashboard user's member record (matched by email in `members` table) — they can only approve for themselves.
- What happens if the network drops during polling? The CLI retries polling. If it fails for 30+ seconds, it shows "Connection lost, retrying..." and continues until expiry.
- What happens if the same user runs `valis login` twice simultaneously? Each gets a unique device code. Both can be approved independently.
- What happens to the old API key login (`tmm_` prompt)? Kept as a fallback: `valis login --api-key` for emergency access.
- What happens if the email entered at registration doesn't match any dashboard auth account? The approval flow creates a Supabase Auth account on first magic link login. The `members.email` column is the source of truth for linking.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST generate a unique, human-readable device code (format: 4 uppercase letters + dash + 4 digits, e.g. "ABCD-1234") when the CLI requests one.
- **FR-002**: System MUST provide a secret device code (UUID) alongside the user code, used only by the CLI for polling.
- **FR-003**: System MUST expire device codes after 15 minutes.
- **FR-004**: System MUST allow authenticated dashboard users to approve or deny pending device codes.
- **FR-005**: On approval, the system MUST match the dashboard auth email to a `members.email` record, link the device code to that member, and return org-level credentials (member_api_key, member_id, author_name, org_id, org_name, supabase_url) to the CLI. Project selection happens later via `valis init`.
- **FR-006**: System MUST support email magic link authentication on the dashboard (no passwords). Default email sender used for MVP.
- **FR-007**: The CLI MUST open the user's default browser to the approval URL automatically, with a fallback to printing the URL for headless environments.
- **FR-008**: The CLI MUST poll the authorization endpoint at 5-second intervals until approval, denial, or expiry.
- **FR-009**: The registration flow (`valis init` → "Create new account") MUST collect the user's email, store it in `members.email`, and create a linked dashboard auth account.
- **FR-010**: System MUST rate-limit device code generation to 3 per IP per hour.
- **FR-011**: The API key login MUST remain available as `valis login --api-key` for backward compatibility.
- **FR-012**: On successful login, the CLI MUST save credentials to `~/.valis/credentials.json` and print the user's name and org.

### Key Entities

- **Device Code**: A temporary authorization token pair (user_code + device_code) with a status (pending/approved/expired/denied), linked to a member on approval. Expires after 15 minutes.
- **Member (updated)**: Now includes an `email` field. Email is the link between dashboard auth sessions and Valis member records.
- **Dashboard Auth Session**: An email-based auth session. Persists in the browser. Required to approve device codes.
- **Credentials File**: Local file (`~/.valis/credentials.json`) storing member_api_key, member_id, author_name, org_id, org_name after successful login.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from `valis login` to authenticated CLI in under 60 seconds (when already logged into the dashboard).
- **SC-002**: A user NOT logged into the dashboard can complete the full flow (email magic link + device approval) in under 3 minutes.
- **SC-003**: Device codes expire reliably after 15 minutes — no orphaned pending codes remain after expiry window.
- **SC-004**: 95% of device code approvals are reflected in CLI polling within 10 seconds of the user clicking "Approve."
- **SC-005**: The CLI provides clear feedback at every stage: code display, browser opening, waiting, success, or failure.
- **SC-006**: The `--api-key` fallback remains functional for users who cannot access a browser.

## Assumptions

- Email magic link functionality is available on the current hosting plan (Supabase free tier includes it).
- Default Supabase email sender (`noreply@mail.app.supabase.io`) used for MVP. Custom SMTP sender domain deferred to backlog.
- Registration will be extended to collect email. Email stored in `members.email` column (new migration).
- Existing member records (only the owner's test account) will be recreated via fresh `valis init`.
- The Valis dashboard (`valis.krukit.co`) is deployed and accessible.
- The `open` command (macOS) / `xdg-open` (Linux) / `start` (Windows) is available for browser opening. If not, the fallback URL print is sufficient.

## Scope Boundaries

**In scope:**
- Device code generation, approval, denial, expiry
- Dashboard login page (email magic link)
- Dashboard device approval page
- CLI `valis login` with device flow
- CLI `valis login --api-key` backward compatibility
- Email collection during `valis init` registration
- `email` column on `members` table (new migration)
- Linking auth accounts to Valis members via email

**Out of scope:**
- Custom SMTP sender domain (deferred to backlog)
- Password-based authentication
- OAuth providers (Google, GitHub)
- Multi-org switching during login
- Session refresh or token rotation
- Dashboard beyond login + device approval (existing pages unchanged)
- Mobile-specific UI for approval page
