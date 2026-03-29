# Tasks: Device Authorization Login

**Input**: Design documents from `/specs/007-device-auth-login/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-endpoints.md

**Tests**: Not explicitly requested — test tasks omitted. Existing test suites (632 CLI, 87 web) provide regression coverage.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US5)
- Paths are relative to repo root

---

## Phase 1: Setup

**Purpose**: Database migration and shared infrastructure

- [x] T001 Create migration `supabase/migrations/008_device_auth.sql` — ALTER TABLE members ADD COLUMN email TEXT UNIQUE; CREATE TABLE device_codes (id, user_code, device_code, member_id, member_api_key, status, expires_at, created_at, ip_address) per data-model.md
- [x] T002 [P] Create browser-side Supabase auth client in `packages/web/src/lib/supabase-browser.ts` — exports `createBrowserClient()` using NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY with auth persistence
- [x] T003 [P] Add `openBrowser(url)` utility in `packages/cli/src/utils/open-browser.ts` — platform detection (macOS: open, Linux: xdg-open, Windows: start), use `execFile` not `exec`, silent failure fallback

**Checkpoint**: Migration ready, shared utilities available

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: API endpoints that both CLI and dashboard depend on

**CRITICAL**: No user story work can begin until these endpoints exist

- [x] T004 Implement `POST /api/device-code` route in `packages/web/src/app/api/device-code/route.ts` — generate user_code (XXXX-1234 format) + device_code (UUID), insert into device_codes table, rate limit 3/IP/hour, return per contracts/api-endpoints.md
- [x] T005 [P] Implement `POST /api/device-authorize` route in `packages/web/src/app/api/device-authorize/route.ts` — accept device_code in body, check status (pending→202, approved→200+credentials, expired→410, denied→403), auto-expire if expires_at < now()
- [x] T006 [P] Implement `POST /api/device-approve` route in `packages/web/src/app/api/device-approve/route.ts` — require Supabase Auth session (cookie), accept user_code + action (approve/deny), on approve: lookup member by auth email → members.email, fill member_api_key + member_id, set status=approved

**Checkpoint**: Foundation ready — all 3 device auth endpoints functional

---

## Phase 3: User Story 1 — CLI Login from New Device (Priority: P1) MVP

**Goal**: `valis login` opens browser, user approves, CLI receives credentials

**Independent Test**: Run `valis login`, verify browser opens with code, approve on dashboard, verify `valis status` works

### Implementation

- [x] T007 [US1] Rewrite `valis login` command in `packages/cli/src/commands/login.ts` — default flow: POST /api/device-code → get user_code + device_code → open browser via openBrowser() → print code + URL → poll /api/device-authorize every 5s → on 200: save credentials → print success. Keep `--api-key` flag for fallback (existing flow)
- [x] T008 [US1] Add `--api-key` flag handling in `packages/cli/src/commands/login.ts` — when flag present, use existing API key prompt flow (password input → exchange-token). Register flag in `packages/cli/bin/valis.ts`
- [x] T009 [US1] Update `packages/cli/src/commands/init.ts` — when user selects "Log in", delegate to new device flow login (not API key prompt)

**Checkpoint**: CLI login via device flow works end-to-end (requires dashboard pages from US2)

---

## Phase 4: User Story 2 — Dashboard Email Login (Priority: P1)

**Goal**: Dashboard login page with Supabase Auth magic link + device approval page

**Independent Test**: Open /auth/login, enter email, receive magic link, click it, verify authenticated. Open /auth/device?code=XXXX, approve, verify status changes

### Implementation

- [x] T010 [US2] Create login page at `packages/web/src/app/auth/login/page.tsx` — email input + "Send magic link" button, Supabase Auth signInWithOtp(), success message "Check your email", redirect handling via ?redirect= param. Dark mode (bg-gray-950/900)
- [x] T011 [US2] Create auth callback handler at `packages/web/src/app/auth/callback/route.ts` — handle Supabase Auth magic link callback, exchange code for session, redirect to ?redirect= URL or /dashboard
- [x] T012 [US2] Create device approval page at `packages/web/src/app/auth/device/page.tsx` — read ?code= param, check Supabase Auth session (redirect to /auth/login if not), show code + "Approve"/"Deny" buttons, POST to /api/device-approve on click, show success/error. Dark mode
- [ ] T013 [US2] Enable Supabase Auth in project — verify email provider enabled in Supabase Dashboard (Settings → Auth → Email), set Site URL to https://valis.krukit.co, add redirect URL https://valis.krukit.co/auth/callback

**Checkpoint**: Full browser-side auth flow works — login + device approval

---

## Phase 5: User Story 3 — CLI Login Without Browser (Priority: P2)

**Goal**: Headless/SSH login — URL + code printed, approve on another device

**Independent Test**: Set BROWSER=none, run valis login, copy URL to phone, approve, verify CLI receives credentials

### Implementation

- [x] T014 [US3] Update `openBrowser()` in `packages/cli/src/utils/open-browser.ts` — detect headless env (BROWSER=none, SSH_TTY set, no DISPLAY), skip browser open, ensure URL is always printed regardless

**Checkpoint**: Headless login works (reuses Phase 2 endpoints + US1 polling logic)

---

## Phase 6: User Story 4 — First Registration with Email (Priority: P2)

**Goal**: `valis init` collects email, links to Supabase Auth account

**Independent Test**: Run `valis init` as new user, enter email. Later on another machine, `valis login` → magic link → approve → works

### Implementation

- [x] T015 [US4] Modify `valis init` hosted flow in `packages/cli/src/commands/init.ts` — add email prompt after name: `await input({ message: 'Your email:' })`, pass email to /api/register
- [x] T016 [US4] Modify `/api/register` in `packages/web/src/app/api/register/route.ts` — accept optional `email` field, store in members.email, call `supabase.auth.admin.createUser({ email, email_confirm: true })` to create Supabase Auth account (no confirmation email sent)

**Checkpoint**: Registration creates linked auth account. User can login on any device via email

---

## Phase 7: User Story 5 — Device Code Expiry and Denial (Priority: P3)

**Goal**: Codes expire after 15 min. Users can deny codes from dashboard

**Independent Test**: Generate code, wait 15 min, verify CLI shows "expired". Generate code, click Deny, verify CLI shows "denied"

### Implementation

- [x] T017 [US5] Add expiry check in `/api/device-authorize` (already in T005) — verify expires_at comparison works correctly, return 410 with clear message
- [x] T018 [US5] Add denial UI in device approval page (already in T012) — verify "Deny" button sends action:"deny", CLI shows "denied" message
- [x] T019 [US5] Add expired code handling in device approval page `packages/web/src/app/auth/device/page.tsx` — if code is expired when page loads, show "This code has expired. Run `valis login` again."

**Checkpoint**: All security boundaries enforced — expiry, denial, rate limiting

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements across all stories

- [ ] T020 [P] Update `docs/PRE-RELEASE-CHECKLIST.md` — add Supabase Auth setup steps (enable email provider, set Site URL, add redirect URL)
- [ ] T021 [P] Update `specs/BACKLOG.md` — mark #28 (valis login) as Done
- [ ] T022 [P] Update `docs/DEPLOY-RUNBOOK.md` — add migration 008, Supabase Auth config section
- [ ] T023 Run quickstart.md validation — execute all flows from quickstart.md manually, verify each works
- [ ] T024 Deploy: `supabase db push` (migration 008) + `vercel deploy --prod` (new API routes + dashboard pages)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 (migration must exist)
- **Phase 3 (US1 — CLI Login)**: Depends on Phase 2 (endpoints must exist)
- **Phase 4 (US2 — Dashboard Login)**: Depends on Phase 2 (endpoints must exist). Can run in parallel with Phase 3
- **Phase 5 (US3 — Headless)**: Depends on Phase 3 (extends US1 logic)
- **Phase 6 (US4 — Registration Email)**: Depends on Phase 1 (email column). Can run in parallel with Phase 3/4
- **Phase 7 (US5 — Expiry/Denial)**: Depends on Phase 2 + Phase 4 (builds on existing endpoints + UI)
- **Phase 8 (Polish)**: Depends on all stories complete

### User Story Dependencies

- **US1 (CLI Login)**: Requires Phase 2 endpoints. Dashboard pages (US2) needed for full E2E but CLI code is independent
- **US2 (Dashboard Login)**: Requires Phase 2 endpoints. Independent from CLI
- **US3 (Headless)**: Extends US1 — requires US1 complete
- **US4 (Registration Email)**: Independent — only touches init + register
- **US5 (Expiry/Denial)**: Extends Phase 2 + US2 — mostly verification of already-built logic

### Parallel Opportunities

**Phase 1**: T002 + T003 can run in parallel (different files)
**Phase 2**: T005 + T006 can run in parallel (different API routes)
**Phase 3 + Phase 4**: US1 (CLI) and US2 (Dashboard) can run in parallel (different packages)
**Phase 6**: US4 can run in parallel with US1/US2 (touches different files)

---

## Parallel Example: Phase 2

```text
# After T001 (migration) and T004 (device-code endpoint):
Agent A: T005 — POST /api/device-authorize (packages/web/src/app/api/device-authorize/)
Agent B: T006 — POST /api/device-approve (packages/web/src/app/api/device-approve/)
```

## Parallel Example: US1 + US2

```text
# After Phase 2 complete:
Agent A: T007-T009 — CLI login command (packages/cli/)
Agent B: T010-T013 — Dashboard pages (packages/web/src/app/auth/)
```

---

## Implementation Strategy

### MVP First (US1 + US2 Only)

1. Phase 1: Setup (migration + utilities) — 30 min
2. Phase 2: 3 API endpoints — 2 hours
3. Phase 3: CLI `valis login` device flow — 1 hour
4. Phase 4: Dashboard login + approval pages — 2 hours
5. **STOP and VALIDATE**: Test full flow end-to-end
6. Deploy + dog-food

### Incremental Delivery

1. Setup + Foundational → endpoints work
2. US1 + US2 → core login flow works (MVP!)
3. US3 → headless support (small delta)
4. US4 → email in registration (small delta)
5. US5 → security verification (mostly built-in)
6. Polish → docs, deploy

---

## Notes

- T001 (migration) must be deployed before any endpoint works
- Supabase Auth email provider must be enabled in Dashboard (T013) — manual step
- Device code format: 4 uppercase letters + dash + 4 digits (e.g. "ABCD-1234")
- Polling interval: 5 seconds
- Code expiry: 15 minutes
- Rate limit: 3 codes per IP per hour
