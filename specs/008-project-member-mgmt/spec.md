# Feature Specification: Web Project Member Management

**Feature Branch**: `008-project-member-mgmt`
**Created**: 2026-03-30
**Status**: Draft
**Input**: Project detail page with member invite by email, member removal, email notifications.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — View Project & Members (Priority: P1)

A project admin clicks on a project name from the dashboard. They see a project detail page showing the project name, a list of all members (name, email, role, when they joined), and an invite form. Regular members can view the page but cannot invite or remove others.

**Why this priority**: Foundation for all member management. Without seeing who's on the project, invite and remove are meaningless.

**Independent Test**: Click a project on dashboard, verify the detail page loads with correct project info and member list.

**Acceptance Scenarios**:

1. **Given** a project admin on the dashboard, **When** they click a project name, **Then** they see the project detail page with name, member count, and full member list.
2. **Given** a project with 3 members, **When** the detail page loads, **Then** all 3 members are shown with name, email, role, and join date.
3. **Given** a regular member (not admin), **When** they view the project page, **Then** they see the member list but the invite form and remove buttons are hidden.

---

### User Story 2 — Invite Member by Email (Priority: P1)

A project admin enters an email address in the invite form and clicks "Invite." The system adds the person to the project and sends them an email notification. If the person doesn't have a Valis account yet, one is created automatically. When they log in, the project appears in their dashboard.

**Why this priority**: Co-equal with viewing — the primary action users want to perform. This replaces the CLI invite code workflow.

**Independent Test**: Enter an email, submit the invite, verify the person appears in the member list and receives an email. Log in as the invited user and verify the project is visible.

**Acceptance Scenarios**:

1. **Given** an admin on the project page, **When** they enter a valid email and click "Invite", **Then** the person is added to the project with "member" role and appears in the member list.
2. **Given** the invited email belongs to an existing Valis user, **When** the invite is sent, **Then** the user is added to this project without creating a new account. They receive a notification email.
3. **Given** the invited email does NOT belong to any Valis user, **When** the invite is sent, **Then** a new account is created with that email, the person is added to the project, and they receive an invitation email with a link to log in.
4. **Given** a successful invite, **When** the invited user logs into the dashboard, **Then** they see the project in their project list.
5. **Given** the email is already a member of this project, **When** the admin tries to invite, **Then** the system shows "Already a member" and does not send a duplicate email.

---

### User Story 3 — Remove Member from Project (Priority: P2)

A project admin clicks "Remove" next to a member's name. A confirmation dialog appears. After confirming, the member is removed from the project. They can still access other projects in the same org.

**Why this priority**: Important but less frequent than inviting. Needed for team changes.

**Independent Test**: Remove a member, verify they disappear from the list. Log in as removed user, verify the project is no longer visible but other projects remain.

**Acceptance Scenarios**:

1. **Given** an admin on the project page, **When** they click "Remove" next to a member and confirm, **Then** the member is removed from the project member list.
2. **Given** a removed member, **When** they log into the dashboard, **Then** they no longer see the removed project but still see other projects.
3. **Given** an admin tries to remove themselves, **When** they click "Remove", **Then** the system shows "Cannot remove yourself."
4. **Given** a project with only one admin, **When** someone tries to remove that admin, **Then** the system shows "Cannot remove the last admin."

---

### User Story 4 — Email Notifications (Priority: P2)

When a member is invited to a project, they receive a branded email from Valis with the project name, who invited them, and a link to log in. The email uses the configured sender domain.

**Why this priority**: Notifications are the bridge between invitation and adoption. Without the email, invited users don't know they have access.

**Independent Test**: Invite a member, check that the email arrives within 60 seconds with correct content and a working login link.

**Acceptance Scenarios**:

1. **Given** a new user is invited, **When** the invitation is processed, **Then** they receive an email within 60 seconds.
2. **Given** the invitation email, **When** the user opens it, **Then** it contains the project name, inviter's name, and a "Log in" button linking to the dashboard.
3. **Given** an existing user is added to a project, **When** the invitation is processed, **Then** they receive a notification email (not an invitation to create an account).

---

### Edge Cases

- What if the email is invalid format? Show validation error before submitting.
- What if the email service is down? Show "Invitation sent but notification email failed. The user can still log in manually." Add the member regardless.
- What if the admin invites 50 people at once? Allow batch invite (one email per line) with progress indicator. Rate limited to 10 per hour per project.
- What if a member is in multiple projects? Removing from one project does not affect other projects.
- What if the project has 0 members after removal? Not possible — cannot remove the last admin.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a project detail page accessible from the dashboard project list, showing project name and full member list.
- **FR-002**: Each member in the list MUST show: display name, email, role (admin/member), and join date.
- **FR-003**: Project admins MUST be able to invite new members by entering an email address.
- **FR-004**: When inviting an email that belongs to an existing Valis user, the system MUST add them to the project without creating a duplicate account.
- **FR-005**: When inviting an email with no existing account, the system MUST create a new member in the same org as the project, link them to the project with "member" role, and create a dashboard login for that email.
- **FR-006**: The system MUST send an email notification to invited users with project name, inviter name, and a login link.
- **FR-007**: Project admins MUST be able to remove members from the project (except themselves and the last admin).
- **FR-008**: The invite form MUST validate email format before submission.
- **FR-009**: The system MUST prevent duplicate invitations (same email to same project).
- **FR-010**: Invitation rate MUST be limited to 10 per hour per project.
- **FR-011**: Regular members (non-admin) MUST be able to view the project page and member list but MUST NOT see invite/remove controls.
- **FR-012**: Removing a member from a project MUST NOT affect their membership in other projects or the org.

### Key Entities

- **Project Member**: A link between a member and a project, with a role (admin/member) and join timestamp. Removing the link removes project access without deleting the member account.
- **Invitation**: The act of adding a member to a project. May create a new account if the email is unknown. Triggers an email notification.
- **Email Notification**: A message sent to invited users containing project context and a login link. Sent via the configured email service.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can invite a new team member to a project in under 30 seconds (enter email, click invite, see confirmation).
- **SC-002**: Invited users receive a notification email within 60 seconds of being invited.
- **SC-003**: 100% of invited users see the project in their dashboard upon first login after invitation.
- **SC-004**: Project member list loads within 2 seconds for projects with up to 100 members.
- **SC-005**: Admin can remove a member in under 10 seconds (click remove, confirm, see updated list).
- **SC-006**: Invitation rate limiting correctly blocks the 11th invitation per hour per project.

## Assumptions

- Email service (Resend) is already configured with the `valis.krukit.co` domain and working.
- Supabase Auth is the authentication system. New users are created via `auth.admin.createUser`.
- The `project_members` table and RLS policies already exist and support the member-project relationship.
- Dashboard uses Supabase Auth sessions for data fetching (via `useDashboardAuth()`).
- Dark mode styling consistent with existing dashboard pages.

## Scope Boundaries

**In scope:**
- Project detail page (`/projects/[id]`)
- Member list with roles and join dates
- Invite by email (single + batch)
- Email notifications for invitations
- Remove member with confirmation
- Permission checks (admin-only actions)
- Rate limiting on invitations

**Out of scope:**
- Change member roles (admin ↔ member) — separate feature
- Project settings (rename, delete) — separate feature
- Transfer project ownership — separate feature
- Custom email templates — use a standard template
- Real-time member list updates (via websocket) — refresh on action is sufficient
