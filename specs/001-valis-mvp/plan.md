# Implementation Plan: Valis MVP

**Branch**: `001-valis-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-valis-mvp/spec.md`

## Summary

Build Valis MVP — shared decision intelligence for AI-augmented
engineering teams. A CLI + MCP server that captures, stores, searches,
and pushes team decisions across developer sessions. Dual storage
(Supabase Postgres + Qdrant Cloud), channel-driven auto-capture, agent-
driven classification, zero native deps. Single `cli` package talks
directly to Supabase and Qdrant. Three Supabase Edge Functions handle
server-side org management.

## Technical Context

**Language/Version**: TypeScript (ES2022, NodeNext module resolution), Node.js 20+
**Edge Functions Runtime**: Deno (Supabase Edge Functions). `supabase/functions/` use Deno imports (`https://esm.sh/@supabase/supabase-js@2`), not Node requires. No shared types between CLI (Node) and Edge Functions (Deno).
**Primary Dependencies**: @modelcontextprotocol/sdk, @supabase/supabase-js, @qdrant/js-client-rest, commander, chokidar, picocolors, zod
**Storage**: Supabase Postgres (source of truth) + Qdrant Cloud (hybrid search, server-side embeddings with FastEmbed MiniLM 384d)
**Auth Model**: CLI uses `service_role key` + application-level org_id filtering. RLS as defense-in-depth (via `set_config('app.org_id', ...)` RPC). Edge Functions use `service_role key` (server-side, trusted). Custom JWT/RLS enforcement deferred to Phase 2.
**Qdrant Setup**: Single global `decisions` collection, created automatically via `ensureCollection` ("create if not exists") on first CLI run. Vector: 384d cosine, sparse BM25 enabled. Reindex from Postgres if schema changes (Postgres = source of truth).
**Testing**: vitest with mocked Supabase/Qdrant clients for unit tests. Real cloud services for manual E2E only (T052). No cloud credentials needed for `pnpm test`.
**Capture Resilience**: CLAUDE.md keyword triggers = baseline (works without channels, ~30-50%). Channel reminders = enhancement (~80%+, graceful fallback). Channels are research preview — not a hard dependency.
**Target Platform**: macOS ARM64/Intel, Linux x64 (CLI tool, npm global install)
**Project Type**: CLI + MCP server (hybrid MCP + Channel)
**Performance Goals**: <200ms store, <2s status/dashboard, <10s seed extraction, <3min full onboarding
**Constraints**: Zero native deps, offline-capable, pure JS/TS, Apache 2.0 license
**Scale/Scope**: Teams 3-50 devs, 500-10K decisions per org (MVP), 3 MCP tools + 8 CLI commands

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | Cloud-First | ✅ PASS | Supabase + Qdrant Cloud from Day 1. Local-only is offline fallback only. |
| II | Minimally Invasive | ✅ PASS | Pure MCP stdio + channel push. No proxy, no stream interception. |
| III | Non-Blocking | ✅ PASS | Offline queue for stores, empty results for search. IDE never blocked. |
| IV | No LLM Dependency (MVP) | ✅ PASS | Agent classifies at store time. No Haiku, no enrichment pipeline. Raw auto-capture stored as `type: pending`. |
| V | Zero Native Dependencies | ✅ PASS | All deps are pure JS/TS: @supabase/supabase-js, @qdrant/js-client-rest, chokidar, commander. No node-gyp. |
| VI | Auto-Capture by Default | ✅ PASS | Three layers: channel reminders (primary), keyword triggers + explicit store (secondary), startup sweep (catch-up). Single process. |
| VII | Dual Storage | ✅ PASS | Every write → INSERT Postgres + UPSERT Qdrant. Partial failure: successful write preserved, failed retried. |
| VIII | Push + Pull | ✅ PASS | MCP tools for pull. Channel notifications for push. Push is supplementary — pull works without it. |

**Security & Data Integrity**: Secret detection before all stores (10 patterns). Tenant isolation via org_id filter (Qdrant) + RLS (Postgres). Config files 0600. HTTPS only.

**Development Workflow**: pnpm workspace, strict TS, actionable error messages, offline queue, content hash dedup, idempotent init.

**All gates pass. No violations. No Complexity Tracking needed.**

## Project Structure

### Documentation (this feature)

```text
specs/001-valis-mvp/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── mcp-tools.md     # MCP tool input/output schemas
│   ├── cli-commands.md  # CLI command interface reference
│   ├── edge-functions.md # Supabase Edge Function APIs
│   └── channel-events.md # Channel push event schemas
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
valis/
├── packages/
│   └── cli/
│       ├── package.json            # "valis" bin, deps, scripts
│       ├── tsconfig.json           # extends ../../tsconfig.base.json
│       ├── bin/
│       │   └── valis.ts          # CLI entry (#!/usr/bin/env node)
│       ├── src/
│       │   ├── commands/
│       │   │   ├── init.ts         # valis init + init --join
│       │   │   ├── serve.ts        # valis serve (unified process)
│       │   │   ├── status.ts       # valis status
│       │   │   ├── dashboard.ts    # valis dashboard
│       │   │   ├── search-cmd.ts   # valis search (CLI wrapper)
│       │   │   ├── export-cmd.ts   # valis export --json/--markdown
│       │   │   ├── config-cmd.ts   # valis config set/get
│       │   │   └── uninstall.ts    # valis uninstall
│       │   ├── mcp/
│       │   │   ├── server.ts       # MCP + Channel server setup
│       │   │   └── tools/
│       │   │       ├── store.ts    # valis_store handler
│       │   │       ├── search.ts   # valis_search handler
│       │   │       └── context.ts  # valis_context handler
│       │   ├── capture/
│       │   │   ├── watcher.ts      # JSONL activity watcher (triggers reminders)
│       │   │   ├── hook-handler.ts # Stop hook HTTP handler
│       │   │   ├── startup-sweep.ts # Process missed transcripts
│       │   │   └── dedup.ts        # Content hash + session_id dedup
│       │   ├── cloud/
│       │   │   ├── supabase.ts     # Supabase client (Postgres + Edge Functions)
│       │   │   └── qdrant.ts       # Qdrant Cloud client (hybrid search)
│       │   ├── seed/
│       │   │   ├── index.ts        # Seed orchestrator
│       │   │   ├── parse-claude-md.ts
│       │   │   ├── parse-agents-md.ts
│       │   │   └── parse-git-log.ts
│       │   ├── ide/
│       │   │   ├── detect.ts       # Detect installed IDEs
│       │   │   ├── claude-code.ts  # Configure Claude Code MCP + hooks
│       │   │   └── codex.ts        # Configure Codex MCP
│       │   ├── security/
│       │   │   └── secrets.ts      # 10 secret detection patterns
│       │   ├── offline/
│       │   │   └── queue.ts        # pending.jsonl read/write/flush
│       │   ├── config/
│       │   │   ├── store.ts        # ~/.valis/config.json CRUD
│       │   │   └── manifest.ts     # Track what init created
│       │   ├── channel/
│       │   │   └── push.ts         # Channel notification emitter
│       │   ├── types.ts            # Decision, RawDecision, Config types
│       │   └── errors.ts           # 7 error message constants
│       └── test/
│           ├── mcp/tools/
│           │   ├── store.test.ts
│           │   ├── search.test.ts
│           │   └── context.test.ts
│           ├── capture/
│           │   ├── watcher.test.ts
│           │   ├── startup-sweep.test.ts
│           │   └── dedup.test.ts
│           ├── cloud/
│           │   ├── supabase.test.ts
│           │   └── qdrant.test.ts
│           ├── seed/
│           │   └── parse-claude-md.test.ts
│           ├── security/
│           │   └── secrets.test.ts
│           └── offline/
│               └── queue.test.ts
├── supabase/
│   ├── config.toml                 # Supabase project config
│   ├── migrations/
│   │   └── 001_init.sql            # orgs, members, decisions, rate_limits, RLS
│   └── functions/
│       ├── create-org/index.ts     # POST — create org + first admin member
│       └── join-org/index.ts       # POST — validate invite, add member
├── package.json                    # Root workspace (private)
├── pnpm-workspace.yaml
├── tsconfig.base.json              # ES2022, NodeNext, strict
├── .gitignore
├── LICENSE                         # Apache 2.0
├── README.md
└── AGENTS.md
```

**Structure Decision**: Single `cli` package in a pnpm monorepo. Supabase
Edge Functions live in `supabase/functions/` at root (standard Supabase CLI
convention). No separate `cloud` package — Edge Functions are minimal
(3 functions, <100 LOC each) and deploy via `supabase functions deploy`.
