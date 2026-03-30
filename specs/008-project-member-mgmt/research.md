# Research: Web Project Member Management

**Feature**: 008-project-member-mgmt
**Date**: 2026-03-30

## Decision 1: Email Sending Library

**Decision**: Install `resend` npm package for sending invitation emails from API routes.

**Rationale**: Resend is already configured as SMTP provider for Supabase Auth (valis.krukit.co domain, DNS verified). Using Resend SDK directly gives more control over email content than Supabase Auth's magic link emails.

**Alternatives considered**:
- Supabase Auth `inviteUserByEmail` — sends Supabase's default invite template, no control over content
- nodemailer + SMTP — more complex, Resend SDK is simpler
- Supabase Edge Function for email — we migrated away from Edge Functions

## Decision 2: Invite Flow Architecture

**Decision**: Server-side API route (`POST /api/invite-member`) handles all logic: check existing member, create if needed, add to project_members, send email via Resend.

**Rationale**: Keeps business logic on server. Browser client only submits email + project ID. Server validates permissions via Supabase Auth session.

**Key flow**:
1. Verify caller is project_admin (via auth.uid() → member → project_members role)
2. Find or create member by email
3. Insert into project_members
4. Send notification email via Resend
5. Return success/error

## Decision 3: Permission Check Pattern

**Decision**: API route checks project admin role server-side. Frontend hides UI controls for non-admins but server enforces.

**Rationale**: Defense in depth. UI hiding is UX convenience; server check is security.

**Implementation**: Query `project_members` where `member_id = auth_user_member_id()` and `project_id = :id` and `role = 'project_admin'`.

## Decision 4: Email Template

**Decision**: Simple HTML email built inline in the API route. No template engine.

**Rationale**: One email type (invitation). Simple enough to inline. No need for template engine complexity.

**Content**: Project name, inviter name, "Log in to Valis" button linking to `https://valis.krukit.co/auth/login`.

## Decision 5: Rate Limiting

**Decision**: Count recent invitations in `project_members` by `joined_at` for the project. If >= 10 in last hour, reject.

**Rationale**: Simple, no extra tables. `joined_at` is already tracked. Low volume during dog-fooding.

## Decision 6: Remove Member

**Decision**: `DELETE /api/remove-member` with project_id + member_id. Server validates admin role, prevents self-removal and last-admin removal.

**Rationale**: Standard REST pattern. DELETE semantics match the action.
