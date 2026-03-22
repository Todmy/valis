<!--
Sync Impact Report
====================
Version change: N/A → 1.0.0 (initial ratification)
Modified principles: N/A (new document)
Added sections:
  - Core Principles (8 principles derived from design-spec-v5.md § 2)
  - Security & Data Integrity
  - Development Workflow
  - Governance
Removed sections: N/A
Templates requiring updates:
  - .specify/templates/plan-template.md — ✅ compatible (Constitution Check
    section already uses generic gates; principles below provide concrete gates)
  - .specify/templates/spec-template.md — ✅ compatible (no constitution-specific
    references; user stories + requirements structure aligns)
  - .specify/templates/tasks-template.md — ✅ compatible (phase-based structure
    accommodates security, offline, and dual-storage tasks naturally)
Follow-up TODOs: none
-->

# Teamind Constitution

## Core Principles

### I. Cloud-First

Team sync, org management, and shared storage MUST be available from
Day 1 of any deployment. Local-only mode is acceptable only as an
offline fallback — never as the default architecture.

**Rationale:** Teamind's core value is *shared* decision intelligence.
A local-first approach would defer the hardest problem (multi-user sync)
and undermine the product's differentiator.

### II. Minimally Invasive

Teamind MUST integrate via standard MCP protocol and Claude Code
channels. It MUST NOT proxy, intercept, or modify IDE data streams.
All IDE interaction happens through registered MCP tools and channel
push notifications.

**Rationale:** Proxy-based approaches create fragile coupling with
IDE internals. MCP is the industry-standard protocol for tool
integration; channels provide push capability without stream
interception.

### III. Non-Blocking

If Teamind is unavailable — cloud down, MCP server crashed, channel
disconnected — the IDE and agent MUST continue to function normally.
No Teamind failure may block, slow, or degrade the developer's
primary workflow.

**Rationale:** Developer trust is lost the moment a background tool
disrupts their work. Graceful degradation (empty search results,
offline queue) is always preferable to errors that halt the session.

### IV. No LLM Dependency (MVP)

The MVP MUST NOT require LLM calls for core functionality (store,
search, context). The agent running in the user's session classifies
decisions at store time. Auto-captured raw text is stored as
`type: 'pending'` without enrichment.

**Rationale:** LLM enrichment adds cost, API key requirements, and
a hard external dependency. The agent already has full session context
and produces higher-quality classification than post-hoc extraction.

### V. Zero Native Dependencies

The npm package MUST install without native compilation on macOS
(ARM64 + Intel) and Linux x64. No `better-sqlite3`, no `node-gyp`,
no platform-specific binaries. Pure JS/TS only.

**Rationale:** Native deps cause 15-25% install failures in the wild.
A CLI tool that can't install is a dead product. Cloud storage
eliminates the need for local SQLite.

### VI. Auto-Capture by Default

Decision capture MUST happen automatically without manual developer
action. Three capture layers — channel-driven reminders (primary),
CLAUDE.md keyword triggers + explicit `teamind_store` (secondary),
and startup sweep (catch-up) — run in a single process.

**Rationale:** Manual capture has <20% compliance. The channel-driven
approach leverages the agent's full session context to produce
high-quality classified decisions at zero additional LLM cost.

### VII. Dual Storage

Postgres (Supabase) is the source of truth. Qdrant Cloud is the
search layer. Every write MUST go to both stores. Partial failure
handling: if one succeeds and the other fails, the successful write
is preserved and the failed write is retried.

**Rationale:** Postgres provides ACID, PITR, and SQL analytics.
Qdrant provides hybrid search (dense + BM25). Neither alone covers
both needs. This is a standard industry pattern for search-heavy
applications.

### VIII. Push + Pull (Hybrid Server)

Teamind MUST operate as a hybrid MCP + Channel server. Pull-based
tools (`teamind_store`, `teamind_search`, `teamind_context`) handle
on-demand access. Channel push delivers real-time team notifications
(new decisions, contradiction alerts) to active sessions.

**Rationale:** Pull-only means the agent must explicitly search to
discover new team decisions. Push closes the awareness gap for active
sessions. Sessions without channel support still work via pull —
push is supplementary, never required.

## Security & Data Integrity

- Secret detection MUST run before any storage operation. If any of
  the 10 defined patterns match, the entire record MUST be blocked
  (not redacted, not stored). Applies to all capture layers.
- Tenant isolation MUST be enforced at every layer: Qdrant queries
  filter by `org_id`, Postgres uses Row Level Security, API keys
  map to a single org.
- API keys and config files MUST be stored with restrictive
  permissions (`0600`). Secrets MUST NOT be committed to version
  control.
- All data in transit MUST use HTTPS. No plaintext connections to
  Supabase or Qdrant Cloud.

## Development Workflow

- **Monorepo structure:** pnpm workspace. Single `cli` package for
  MVP. Cloud logic (Supabase Edge Functions) lives alongside or is
  deployed separately.
- **TypeScript strict mode:** `strict: true` in tsconfig. No `any`
  types in production code without explicit justification.
- **Error messages:** Every user-facing error MUST include: what
  happened, why, and how to fix it (per spec Section 13).
- **Offline resilience:** Store operations MUST queue to
  `~/.teamind/pending.jsonl` when cloud is unreachable. Search
  operations MUST return empty results (not errors) when offline.
- **Deduplication:** Content hash + session_id dedup MUST prevent
  duplicate decisions across all capture layers.
- **Idempotent configuration:** `teamind init` and IDE config
  operations MUST be safe to re-run without duplicating entries.

## Governance

This constitution captures the non-negotiable architectural
principles of Teamind. It supersedes ad-hoc decisions made during
implementation when there is a conflict.

- **Amendments:** Any change to a core principle MUST be documented
  with rationale, approved by the project lead, and reflected in a
  version bump. Adding a principle = MINOR bump. Removing or
  redefining a principle = MAJOR bump. Clarifications = PATCH bump.
- **Compliance:** All implementation plans (via `/speckit.plan`)
  MUST pass a Constitution Check against these principles before
  proceeding to design. Violations MUST be justified in the
  Complexity Tracking table.
- **Review:** Principles SHOULD be reviewed when the product scope
  changes significantly (e.g., Phase 2 features, new storage
  backends, new IDE integrations).
- **Runtime guidance:** For day-to-day development patterns, refer
  to `AGENTS.md` and `CLAUDE.md` in the project root. This
  constitution governs *architecture*; those files govern *workflow*.

**Version**: 1.0.0 | **Ratified**: 2026-03-22 | **Last Amended**: 2026-03-22
