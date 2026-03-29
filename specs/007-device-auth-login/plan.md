# Implementation Plan: Device Authorization Login

**Branch**: `007-device-auth-login` | **Date**: 2026-03-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/007-device-auth-login/spec.md`

## Summary

Implement browser-based Device Authorization Grant (RFC 8628) for `valis login`. The CLI opens a browser to the Valis dashboard where the user approves the login. Dashboard authentication uses Supabase Auth magic links (email). On approval, CLI receives member credentials and saves them locally.

## Technical Context

**Language/Version**: TypeScript (ES2022, NodeNext), Node.js 20+
**Primary Dependencies**: `@supabase/supabase-js` (auth + DB), `jose` (JWT), `@inquirer/select` (CLI prompts), `next` (dashboard)
**Storage**: Supabase Postgres (members, device_codes tables) + Supabase Auth (magic link sessions)
**Testing**: Vitest (CLI: 632 tests, Web: 87 tests)
**Target Platform**: CLI (macOS/Linux/Windows), Web dashboard (Vercel)
**Project Type**: CLI + Web monorepo (packages/cli + packages/web)
**Performance Goals**: Device approval reflected in CLI within 10 seconds. Full flow under 60 seconds (logged in) or 3 minutes (not logged in).
**Constraints**: No native deps. Magic link via default Supabase sender. Device codes expire in 15 minutes.
**Scale/Scope**: Single-digit concurrent users during dog-fooding. 3 API endpoints, 2 dashboard pages, 1 migration, CLI command modifications.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Cloud-First | PASS | Device flow requires cloud (dashboard + API) |
| II. Minimally Invasive | PASS | No IDE modification — CLI command + web pages only |
| III. Non-Blocking | PASS | Login failure doesn't block IDE. Fallback: `--api-key` |
| IV. No LLM Dependency | PASS | No LLM calls in auth flow |
| V. Zero Native Dependencies | PASS | No new native deps. Uses `execFile` for browser (Node built-in) |
| VI. Auto-Capture | N/A | Auth feature, not capture |
| VII. Dual Storage | N/A | Device codes in Postgres only (no Qdrant for auth) |
| VIII. Push + Pull | N/A | Auth feature, not MCP tools |
| IX. Decision Lifecycle | N/A | Auth feature |
| X. Identity-First Access | PASS | Strengthens identity — adds email-based auth alongside API keys |
| XI. Project-Scoped Isolation | PASS | Device approval returns member credentials scoped to their org |
| Security | PASS | Device codes expire (15min), rate limited (3/IP/hr), secret device_code for polling |
| Dev Workflow | PASS | Migration additive (new column + new table). Idempotent registration updated. |

**Post-design re-check**: All gates pass. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/007-device-auth-login/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research decisions
├── data-model.md        # Migration 008 schema
├── quickstart.md        # User-facing quick start guide
├── contracts/
│   └── api-endpoints.md # API contracts for 3 endpoints + CLI
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
supabase/
└── migrations/
    └── 008_device_auth.sql          # New migration: email column + device_codes table

packages/cli/
├── src/commands/
│   ├── login.ts                     # Modified: device flow (default) + --api-key fallback
│   └── init.ts                      # Modified: collect email during registration
├── src/config/
│   └── credentials.ts               # Unchanged (already stores member_api_key)
└── test/
    └── commands/login.test.ts        # New: device flow tests

packages/web/
├── src/app/
│   ├── auth/
│   │   ├── layout.tsx               # New: bypasses AuthGate for /auth/* pages
│   │   ├── login/page.tsx           # New: magic link login page
│   │   ├── callback/route.ts        # New: magic link callback handler
│   │   └── device/page.tsx          # New: device code approval page
│   └── api/
│       ├── device-code/route.ts     # New: generate device code
│       ├── device-authorize/route.ts # New: CLI polls this
│       └── device-approve/route.ts  # New: dashboard approves here
│       └── register/route.ts        # Modified: accept email, create Supabase Auth user
└── src/lib/
    └── supabase-browser.ts          # New: browser-side Supabase client for Auth
```

**Structure Decision**: Feature spans both packages (CLI + web) plus a new migration. No new packages. Dashboard auth pages are additive (existing pages unchanged).

## Complexity Tracking

No constitution violations. No complexity justifications needed.
