# Implementation Plan: Retention, Collaboration & Enterprise Readiness

**Branch**: `002-retention-enterprise` | **Date**: 2026-03-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-retention-enterprise/spec.md`

## Summary

Extend the Valis MVP with decision lifecycle management (status
transitions, relationships, contradiction detection), cross-session
real-time push via Supabase Realtime, per-member API keys with RBAC
and JWT-based RLS, and unit economics instrumentation. All changes
are additive — backward compatible with existing MVP installations.

## Technical Context

**Language/Version**: TypeScript (ES2022, NodeNext module resolution), Node.js 20+
**Edge Functions Runtime**: Deno (Supabase Edge Functions). New functions: exchange-token, rotate-key, revoke-member, change-status.
**Primary Dependencies**: Existing MVP deps + `jose` (JWT signing, already in dependency tree via supabase-js)
**Storage**: Supabase Postgres (extended schema) + Qdrant Cloud (extended payload) + Supabase Realtime (new: cross-session push)
**Auth Model**: Per-member API keys (`tmm_` prefix) → Edge Function exchanges for short-lived JWT (1h, HS256) → CLI uses JWT via `createClient({ accessToken })`. Legacy org-level keys (`tm_` prefix) continue to work. Edge Functions use `service_role` key (trusted server-side).
**Realtime**: Supabase Realtime `postgres_changes` subscription on `decisions` table, filtered by `org_id`. Each `valis serve` instance subscribes to its org's channel. Events pushed to local IDE via MCP channel notifications.
**Contradiction Detection**: Two-tier — `affects` array overlap (SQL `&&` operator) + Qdrant embedding cosine similarity (threshold >0.7). No LLM dependency.
**Testing**: vitest with mocked Supabase/Qdrant/Realtime clients. Manual E2E with two sessions for cross-session push validation.
**Target Platform**: macOS ARM64/Intel, Linux x64 (unchanged)
**Project Type**: CLI + MCP server (extended)
**Performance Goals**: <500ms lifecycle ops, <5s cross-session push delivery, <5s metrics computation
**Constraints**: Zero native deps, offline-capable, backward compatible with MVP, additive-only migrations
**Scale/Scope**: Teams 3-50 devs, 500-10K decisions, 4 new Edge Functions, 1 new MCP tool, 3 extended MCP tools, 4 new/extended CLI commands

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Cloud-First | ✅ PASS | Supabase Realtime for cross-session push. All new features cloud-native. |
| II | Minimally Invasive | ✅ PASS | Same MCP + channel integration. No new IDE interception. Realtime subscription is server-side. |
| III | Non-Blocking | ✅ PASS | Realtime failure → silent degradation. Contradiction detection → warning not block. Auth failure → offline queue. |
| IV | No LLM Dependency | ✅ PASS | Contradiction detection uses embedding similarity + area overlap. No LLM calls. |
| V | Zero Native Dependencies | ✅ PASS | `jose` is pure JS (already in tree). No new native deps. |
| VI | Auto-Capture by Default | ✅ PASS | Unchanged. Three capture layers preserved. |
| VII | Dual Storage | ✅ PASS | Every write still goes to both stores. New fields replicated to Qdrant payload. |
| VIII | Push + Pull | ✅ PASS | Cross-session push via Supabase Realtime. Pull still works without push. Push is supplementary. |
| IX | Decision Lifecycle | ✅ PASS | Status transitions, relationships, contradiction detection all implemented per principle. |
| X | Identity-First Access | ✅ PASS | Per-member keys, RBAC, JWT enforcement, key rotation, audit trail all implemented. |

**Security & Data Integrity**: JWT-based RLS (native Supabase enforcement, not set_config). Per-member audit trail. Key rotation with immediate invalidation. Secret detection unchanged.

**Development Workflow**: Additive migration (002). Backward-compatible auth. Unit economics instrumentation via existing rate_limits table.

## Project Structure

### Documentation (this feature)

```text
specs/002-retention-enterprise/
├── plan.md              # This file
├── research.md          # Phase 0: Realtime, JWT, contradiction research
├── data-model.md        # Phase 1: Extended schema, new entities
├── quickstart.md        # Phase 1: Validation checklist
├── contracts/
│   ├── edge-functions.md  # 4 new Edge Functions
│   ├── mcp-tools.md       # Extended store/search + new lifecycle tool
│   ├── cli-commands.md    # admin metrics/audit, migrate-auth
│   └── realtime-events.md # Cross-session push events
└── tasks.md             # Phase 2: /speckit.tasks output
```

### Source Code (repository root)

```text
packages/cli/src/
├── types.ts                    # Extended: Decision, Member, new types
├── cloud/
│   ├── supabase.ts             # Extended: JWT auth, lifecycle ops
│   ├── qdrant.ts               # Extended: contradiction similarity
│   └── realtime.ts             # NEW: Supabase Realtime subscription
├── mcp/
│   ├── server.ts               # Extended: register lifecycle tool
│   └── tools/
│       ├── store.ts            # Extended: replaces, depends_on, contradictions
│       ├── search.ts           # Extended: status ranking, labels
│       ├── context.ts          # Extended: status-aware grouping
│       └── lifecycle.ts        # NEW: deprecate, promote, history
├── auth/
│   ├── jwt.ts                  # NEW: JWT caching, refresh, exchange
│   └── rbac.ts                 # NEW: permission checks
├── contradiction/
│   └── detect.ts               # NEW: area overlap + similarity
├── commands/
│   ├── serve.ts                # Extended: Realtime subscription
│   ├── status.ts               # Extended: auth mode, realtime status
│   ├── dashboard.ts            # Extended: contradictions, lifecycle stats
│   ├── admin-metrics.ts        # NEW: platform operator metrics
│   ├── admin-audit.ts          # NEW: audit trail viewer
│   └── migrate-auth.ts         # NEW: legacy → JWT migration
├── ...                         # Remaining MVP files unchanged

supabase/
├── migrations/
│   ├── 001_init.sql            # Unchanged (MVP)
│   └── 002_retention.sql       # NEW: additive schema changes
├── functions/
│   ├── create-org/             # Unchanged
│   ├── join-org/               # Extended: issue per-member key
│   ├── exchange-token/         # NEW: API key → JWT
│   ├── rotate-key/             # NEW (was deferred from MVP)
│   ├── revoke-member/          # NEW
│   └── change-status/          # NEW: decision lifecycle

packages/cli/test/
├── auth/                       # NEW: JWT, RBAC tests
├── contradiction/              # NEW: detection tests
├── cloud/
│   └── realtime.test.ts        # NEW: subscription tests
└── mcp/
    └── lifecycle.test.ts       # NEW: lifecycle tool tests
```

**Structure Decision**: Extends existing MVP monorepo structure. New
modules added alongside existing ones. No restructuring needed.

## Complexity Tracking

> No Constitution Check violations. All principles pass.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | — |
