# Implementation Plan: Registration API

**Branch**: `005-registration-api` | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-registration-api/spec.md`

## Summary

Replace the `.hosted-env` file and hardcoded `HOSTED_CREDENTIALS` with a
public registration Edge Function. The `register` endpoint creates an org,
default project, and first member atomically — returning only a per-member
API key and public endpoint URLs. The service_role key never leaves the
server. The CLI's `teamind init` hosted mode is rewritten to call this
endpoint instead of loading credentials from local files. A modified
`join-project` endpoint enables frictionless teammate onboarding via invite
code with no pre-existing config. Community mode remains unchanged.

This is a small, focused feature (~15-20 tasks) that adds one new Edge
Function, modifies one existing Edge Function, rewrites the CLI init
hosted path, and removes legacy credential loading code.

## Technical Context

**Language/Version**: TypeScript (ES2022, NodeNext module resolution), Node.js 20+
**Edge Functions Runtime**: Deno (Supabase Edge Functions). New: `register`. Modified: `join-project`.
**Primary Dependencies**: Existing deps only — no new packages
**Storage**: Supabase Postgres (migration 005: `registration_rate_limits` table) + Qdrant Cloud (unchanged)
**Auth Model**: Per-member API keys (`tmm_` prefix) issued at registration. Existing `exchange-token` flow reused for subsequent operations. No changes to JWT minting.
**Config**: Hosted mode config drops `supabase_service_role_key` and `qdrant_api_key`. Uses `member_api_key` + public `supabase_url` + public `qdrant_url` only.
**Testing**: vitest. Mock fetch for registration API calls. Integration test for init flow.
**Target Platform**: macOS ARM64/Intel, Linux x64 (unchanged)
**Project Type**: CLI + MCP server (modified)
**Performance Goals**: Registration endpoint responds in <2 seconds. Init completes in <60 seconds.
**Constraints**: Zero native deps, backward compatible with Phases 1-4, community mode unchanged
**Scale/Scope**: 1 new Edge Function, 1 modified Edge Function, 1 new migration, 1 CLI command rewrite, ~15-20 tasks

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Cloud-First | PASS | Registration is a cloud API call. No local-only registration path. |
| II | Minimally Invasive | PASS | No IDE interception changes. Init prompts are simplified (fewer inputs). |
| III | Non-Blocking | PASS | Registration failure shows clear error with retry/community fallback. Does not block IDE. |
| IV | No LLM Dependency | PASS | No LLM calls. Registration is deterministic CRUD. |
| V | Zero Native Dependencies | PASS | No new dependencies. Uses built-in `fetch` for API calls. |
| VI | Auto-Capture by Default | PASS | Unchanged. Capture layers work with per-member key via exchange-token. |
| VII | Dual Storage | PASS | Unchanged. Qdrant setup still runs during init. Seed still writes to both stores. |
| VIII | Push + Pull | PASS | Unchanged. Realtime subscriptions work with per-member JWT. |
| IX | Decision Lifecycle | PASS | Unchanged. Lifecycle operations use exchange-token JWT (already works with tmm_ keys). |
| X | Identity-First Access Control | **IMPROVES** | Removes service_role key from client machines. Every operation now uses per-member credentials. Stronger compliance with this principle. |
| XI | Project-Scoped Isolation | PASS | Registration creates a project. Join resolves to a project. Per-directory config written. |

**Security & Data Integrity**: Service_role key removed from all client paths. Rate limiting prevents registration abuse. Per-member API keys provide auditability. Public URLs in response are not secrets.

**Development Workflow**: Migration 005 is additive only (one new table). No changes to existing tables. All existing tests continue to pass.

## Project Structure

### Documentation (this feature)

```text
specs/005-registration-api/
├── plan.md              # This file
├── research.md          # Phase 0: Registration approach, rate limiting, CLI rewrite
├── data-model.md        # Phase 1: registration_rate_limits table
├── quickstart.md        # Phase 1: Validation checklist for all 4 user stories
├── contracts/
│   └── edge-functions.md  # 1 new + 1 modified Edge Function
└── tasks.md             # Phase 2: Implementation tasks
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── 005_registration_api.sql     # NEW: registration_rate_limits table
├── functions/
│   ├── register/
│   │   └── index.ts                 # NEW: public registration endpoint
│   └── join-project/
│       └── index.ts                 # MODIFIED: add supabase_url, qdrant_url to response

packages/cli/src/
├── types.ts                         # MODIFIED: RegistrationResponse type, remove service_role from hosted config
├── commands/
│   └── init.ts                      # MODIFIED: rewrite hosted mode, remove loadHostedEnv/HOSTED_CREDENTIALS
├── cloud/
│   └── registration.ts              # NEW: register() and joinPublic() API client functions

packages/cli/test/
├── commands/
│   └── init.test.ts                 # MODIFIED: test hosted registration flow
├── cloud/
│   └── registration.test.ts         # NEW: registration API client tests
```

**Structure Decision**: Minimal changes to existing structure. One new
Edge Function directory, one new client module, modifications to init.ts
and types.ts. No new CLI commands — registration is part of the existing
`init` flow.

## Complexity Tracking

> No Constitution Check violations. All 11 principles pass (one improves).

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | — |
