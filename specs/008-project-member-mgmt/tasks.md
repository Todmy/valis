# Tasks: Web Project Member Management

**Input**: Design documents from `/specs/008-project-member-mgmt/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-endpoints.md

**Tests**: Not explicitly requested — existing test suites provide regression coverage.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1-US4)
- Paths relative to repo root

---

## Phase 1: Setup

**Purpose**: Install dependencies and create shared utilities

- [ ] T001 Install `resend` package: `npx pnpm@9 add --filter ./packages/web resend`
- [ ] T002 [P] Create Resend client singleton in `packages/web/src/lib/resend.ts` — export `getResendClient()` using `RESEND_API_KEY` env var
- [ ] T003 [P] Add `RESEND_API_KEY` to Vercel env vars and `packages/web/.env.example`

**Checkpoint**: Resend client available for email sending

---

## Phase 2: Foundational (API Endpoints)

**Purpose**: Server-side logic for invite and remove — required by all stories

- [ ] T004 Create `packages/web/src/app/api/invite-member/route.ts` — POST handler per contracts/api-endpoints.md: validate auth (Supabase Auth session via getUser), check project_admin role, find-or-create member by email (new members join the project's org with "member" role + Supabase Auth user created), add to project_members, send email via Resend, rate limit 10/hour/project. Handle: existing member (409), invalid email (400), not admin (403), rate limit (429)
- [ ] T005 [P] Create `packages/web/src/app/api/remove-member/route.ts` — POST handler: validate auth, check project_admin role, prevent self-removal, prevent last-admin removal, delete from project_members. Handle: self-removal (400), last admin (400), not admin (403), not found (404)

**Checkpoint**: Both API endpoints functional

---

## Phase 3: User Story 1 — View Project & Members (Priority: P1) MVP

**Goal**: Project detail page with member list

**Independent Test**: Click project on dashboard → see project name + member list with roles

### Implementation

- [ ] T006 [US1] Create `packages/web/src/app/projects/[id]/page.tsx` — 'use client', dark mode, useDashboardAuth(). Query project by ID + project_members with joined members. Show: project name, member count, member table (name, email, role badge, joined date). Check if current user is project_admin via separate query → set `isAdmin` state
- [ ] T007 [US1] Update dashboard project links in `packages/web/src/app/dashboard/page.tsx` — change project card `<a href>` to use Next.js `<Link>` component pointing to `/projects/{project_id}`

**Checkpoint**: Can navigate from dashboard to project page and see members

---

## Phase 4: User Story 2 — Invite Member by Email (Priority: P1)

**Goal**: Admin can invite by email, person gets added + receives email

**Independent Test**: Enter email on project page → member appears in list → invited user sees project on login

### Implementation

- [ ] T008 [US2] Add invite form to `packages/web/src/app/projects/[id]/page.tsx` — visible only when `isAdmin`. Email input + "Invite" button. On submit: POST to `/api/invite-member` with project_id + email. Show success/error message. Refresh member list on success
- [ ] T009 [US2] Create invitation email HTML in `packages/web/src/app/api/invite-member/route.ts` — inline HTML template with: Valis logo text, "You've been invited to {project_name}", "Invited by {inviter_name}", "Log in" button linking to `https://valis.krukit.co/auth/login`. Dark-themed email matching brand

**Checkpoint**: Full invite flow works — enter email → member added → email sent → invited user sees project

---

## Phase 5: User Story 3 — Remove Member (Priority: P2)

**Goal**: Admin can remove member with confirmation

**Independent Test**: Click Remove → confirm → member disappears from list

### Implementation

- [ ] T010 [US3] Add remove button to member list in `packages/web/src/app/projects/[id]/page.tsx` — visible only when `isAdmin` and member is not self. On click: show confirmation dialog (window.confirm or inline). On confirm: POST to `/api/remove-member` with project_id + member_id. Refresh list on success. Show error if last admin or self

**Checkpoint**: Can remove members, list updates immediately

---

## Phase 6: User Story 4 — Email Notifications (Priority: P2)

**Goal**: Invited users receive branded email

**Independent Test**: Invite a user → check inbox → email arrives with project name + login link

### Implementation

- [ ] T011 [US4] Verify email sending in `/api/invite-member` (already implemented in T004/T009). Test with real email. Verify: arrives within 60s, contains project name, inviter name, working login link. Differentiate message for new users ("You've been invited") vs existing users ("You've been added")

**Checkpoint**: Emails arrive correctly for both new and existing users

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T012 [P] Update nav sidebar in `packages/web/src/app/app-shell.tsx` — add "Projects" link to DashboardNav, pointing to `/dashboard` (projects section)
- [ ] T013 [P] Add `RESEND_API_KEY` env var documentation to `docs/PRE-RELEASE-CHECKLIST.md` and `docs/DEPLOY-RUNBOOK.md`
- [ ] T014 Run all tests: `npx pnpm@9 --filter ./packages/web test && npx pnpm@9 --filter ./packages/cli test`
- [ ] T015 Deploy: `supabase db push` (no new migrations) + `vercel deploy --prod`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on T002 (Resend client)
- **Phase 3 (US1)**: Can start after Phase 1 (no API dependency for viewing)
- **Phase 4 (US2)**: Depends on Phase 2 (invite endpoint) + Phase 3 (page exists)
- **Phase 5 (US3)**: Depends on Phase 2 (remove endpoint) + Phase 3 (page exists)
- **Phase 6 (US4)**: Depends on Phase 4 (invite flow)
- **Phase 7 (Polish)**: After all stories

### Parallel Opportunities

- **Phase 1**: T002 + T003 parallel (different files)
- **Phase 2**: T004 + T005 parallel (different API routes)
- **Phase 3 + Phase 2**: US1 page (T006) can start while API routes are being built
- **Phase 7**: T012 + T013 parallel

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1: Install Resend — 10 min
2. Phase 2: Two API endpoints — 2 hours
3. Phase 3: Project detail page — 1 hour
4. Phase 4: Invite form + email — 1 hour
5. **STOP and TEST**: Full invite flow end-to-end
6. Deploy

### Incremental Delivery

1. Setup + API endpoints → foundation ready
2. US1 (view page) → can browse projects (MVP!)
3. US2 (invite) → can add teammates
4. US3 (remove) → can manage team
5. US4 (email verification) → polish
6. Deploy

---

## Notes

- No database migrations needed — existing tables are sufficient
- Resend API key must be added to Vercel env vars before deploy
- Rate limiting uses `joined_at` timestamps in project_members (no extra table)
- Email template is inline HTML (no template engine)
- Dark mode styling matches existing dashboard pages
