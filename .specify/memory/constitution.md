<!--
Sync Impact Report
====================
Version change: 1.1.0 -> 1.2.0 (MINOR)
Added principles:
  - XI. Project-Scoped Isolation (organizations contain multiple
    projects, decisions scoped to project, per-project access control,
    search project-scoped by default with cross-project flag)
Modified sections:
  - Security & Data Integrity: tenant isolation updated to project-level
  - X. Identity-First Access Control: RBAC expanded with per-project roles
Removed sections: none
Templates requiring updates:
  - .specify/templates/plan-template.md -- compatible (generic gates)
  - .specify/templates/spec-template.md -- compatible
  - .specify/templates/tasks-template.md -- compatible
Follow-up TODOs: none
-->

# Valis Constitution

## Core Principles

### I. Cloud-First

Team sync, org management, and shared storage MUST be available from
Day 1 of any deployment. Local-only mode is acceptable only as an
offline fallback — never as the default architecture.

**Rationale:** Valis's core value is *shared* decision intelligence.
A local-first approach would defer the hardest problem (multi-user sync)
and undermine the product's differentiator.

### II. Minimally Invasive

Valis MUST integrate via standard MCP protocol and Claude Code
channels. It MUST NOT proxy, intercept, or modify IDE data streams.
All IDE interaction happens through registered MCP tools and channel
push notifications.

**Rationale:** Proxy-based approaches create fragile coupling with
IDE internals. MCP is the industry-standard protocol for tool
integration; channels provide push capability without stream
interception.

### III. Non-Blocking

If Valis is unavailable — cloud down, MCP server crashed, channel
disconnected — the IDE and agent MUST continue to function normally.
No Valis failure may block, slow, or degrade the developer's
primary workflow.

**Rationale:** Developer trust is lost the moment a background tool
disrupts their work. Graceful degradation (empty search results,
offline queue) is always preferable to errors that halt the session.

### IV. No LLM Dependency for Core Ops

Core operations (store, search, context) MUST NOT require LLM calls.
The agent running in the user's session classifies decisions at store
time. Auto-captured raw text is stored as `type: 'pending'` without
enrichment. Enrichment features (e.g., auto-classification of pending
decisions) MAY use LLM optionally but MUST degrade gracefully without
it — never blocking core flows.

**Rationale:** LLM enrichment adds cost, API key requirements, and
a hard external dependency. The agent already has full session context
and produces higher-quality classification than post-hoc extraction.
Optional enrichment can enhance quality without compromising
reliability.

### V. Zero Native Dependencies

The npm package MUST install without native compilation on macOS
(ARM64 + Intel) and Linux x64. No `better-sqlite3`, no `node-gyp`,
no platform-specific binaries. Pure JS/TS only.

**Rationale:** Native deps cause 15-25% install failures in the wild.
A CLI tool that can't install is a dead product. Cloud storage
eliminates the need for local SQLite.

### VI. Auto-Capture by Default

Decision capture MUST happen automatically without manual developer
action. Three capture layers — CLAUDE.md keyword triggers + explicit
`valis_store` (baseline), channel-driven reminders (enhancement),
and startup sweep (catch-up) — run in a single process. The baseline
MUST work without channels. Channels improve capture rate (~80% vs
~30-50%) but MUST NOT be a hard dependency.

**Rationale:** Manual capture has <20% compliance. Channels are
research preview and may change — the system must degrade gracefully.
CLAUDE.md triggers are the stable foundation; channels enhance when
available.

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

Valis MUST operate as a hybrid MCP + Channel server. Pull-based
tools (`valis_store`, `valis_search`, `valis_context`) handle
on-demand access. Channel push delivers real-time team notifications
(new decisions, contradiction alerts) to active sessions.

Cross-session push (Dev A stores -> Dev B receives) MUST be supported
via Supabase Realtime subscriptions. Local-session push remains the
baseline; cross-session push MUST degrade gracefully if Realtime is
unavailable (pull still works). Push is supplementary — never required.

**Rationale:** Pull-only means the agent must explicitly search to
discover new team decisions. Push closes the awareness gap for active
sessions. Cross-session push transforms Valis from a shared database
into a real-time team awareness tool — the core differentiator for
retention.

### IX. Decision Lifecycle

Decisions are living artifacts, not immutable records. The system MUST
support:

- **Status transitions**: `active -> deprecated`, `active -> superseded`,
  `proposed -> active`. Every transition MUST record who changed it
  and why.
- **Relationships**: `depends_on` and `replaces` links between
  decisions. When a decision is stored with `replaces: <id>`, the
  replaced decision MUST transition to `superseded` automatically.
- **Contradiction detection**: When a new decision conflicts with an
  existing active decision (same `affects` areas, opposing content),
  the system MUST flag the contradiction to the storing user. Both
  decisions remain `active` until explicitly resolved.

**Rationale:** Without lifecycle management, the team brain accumulates
stale and contradictory decisions. Trust degrades as developers
encounter outdated guidance. Lifecycle support is the difference
between a knowledge dump and a living knowledge base.

### X. Identity-First Access Control

Every mutation (store, status change, key rotation) MUST be
attributable to a specific member via per-member credentials.

- **Per-member API keys**: Each member MUST have their own API key
  issued at join time. Individual keys enable revocation without
  disrupting other members and provide a complete audit trail.
- **RBAC**: Three levels of access control:
  - **Org admin**: manages org settings, billing, member invites.
  - **Project admin**: manages project members, key rotation within
    the project, project settings.
  - **Project member**: can store, search, and change decision status
    within projects they have access to.
- **Key rotation**: Admins MUST be able to rotate org-level and
  member-level API keys. Rotation MUST invalidate the old key
  immediately.
- **JWT enforcement**: Client authentication MUST use custom JWTs
  (not `service_role` key) so that Postgres RLS is enforced by
  Supabase natively — not via application-level `set_config` calls.
  JWTs MUST include both `org_id` and `project_id` claims for
  project-scoped RLS.

**Rationale:** Org-level API keys cannot distinguish who did what,
cannot be revoked per-member, and bypass Supabase's native RLS
enforcement. Enterprise customers require auditability and
least-privilege access. Per-project roles ensure developers only
see decisions relevant to their work.

### XI. Project-Scoped Isolation

An organization MUST support multiple projects. Each project is an
independent knowledge base within the org.

- **Decisions belong to a project**: Every decision MUST be scoped
  to exactly one project via `project_id`. There are no "org-level"
  decisions — all decisions live in a project.
- **Per-project membership**: Members MUST be granted access to
  specific projects. Being an org member does NOT automatically grant
  access to all projects.
- **Search is project-scoped**: `valis_search` and
  `valis_context` MUST filter by the active project by default.
  Cross-project search is available via an explicit `--all-projects`
  flag or MCP parameter, but MUST NOT be the default.
- **Push is project-scoped**: Cross-session push notifications MUST
  only be delivered to members of the same project, not the entire
  org.
- **Init selects a project**: `valis init` MUST either create a
  new project or select an existing one. The active project is stored
  in the local config.

**Rationale:** Teams work on multiple codebases. A frontend team
should not see backend API decisions by default — it creates noise
and reduces trust in search relevance. Project scoping provides the
right granularity: fine enough to be relevant, broad enough to
capture cross-cutting concerns within a codebase. Cross-project
search remains available for architects who need the full picture.

## Security & Data Integrity

- Secret detection MUST run before any storage operation. If any of
  the 10 defined patterns match, the entire record MUST be blocked
  (not redacted, not stored). Applies to all capture layers.
- Tenant isolation MUST be enforced at every layer: Qdrant queries
  filter by `project_id`, Postgres RLS enforced via JWT claims
  (`org_id` + `project_id`), per-member API keys map to specific
  project access.
- API keys and config files MUST be stored with restrictive
  permissions (`0600`). Secrets MUST NOT be committed to version
  control.
- All data in transit MUST use HTTPS. No plaintext connections to
  Supabase or Qdrant Cloud.
- Every state-changing operation MUST be attributable to a specific
  member. Audit trail (who, what, when, which project) MUST be
  queryable.
- Key rotation MUST be available for compromise response. Rotated
  keys MUST be invalidated immediately — no grace period.
- Bulk data extraction (export) MUST NOT be available to regular
  members. Admin-only via dashboard if needed, with audit trail.

## Development Workflow

- **Monorepo structure:** pnpm workspace. `cli` package + `web`
  package. Cloud logic (Supabase Edge Functions) lives alongside
  or is deployed separately.
- **TypeScript strict mode:** `strict: true` in tsconfig. No `any`
  types in production code without explicit justification.
- **Error messages:** Every user-facing error MUST include: what
  happened, why, and how to fix it (per spec Section 13).
- **Offline resilience:** Store operations MUST queue to
  `~/.valis/pending.jsonl` when cloud is unreachable. Search
  operations MUST return empty results (not errors) when offline.
- **Deduplication:** Content hash + session_id dedup MUST prevent
  duplicate decisions across all capture layers.
- **Idempotent configuration:** `valis init` and IDE config
  operations MUST be safe to re-run without duplicating entries.
- **Backward-compatible migrations:** Schema changes MUST be
  additive (new columns, new tables). Destructive changes (column
  removal, type changes) MUST go through a deprecation cycle:
  add new -> migrate data -> remove old.
- **Unit economics instrumentation:** Track from launch: COGS per
  org (Supabase + Qdrant usage), activation rate (init -> first
  store), conversion rate (free -> paid), churn (monthly org
  activity). The `rate_limits` table provides the foundation.

## Governance

This constitution captures the non-negotiable architectural
principles of Valis. It supersedes ad-hoc decisions made during
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
  changes significantly (e.g., new storage backends, new IDE
  integrations, new pricing tiers).
- **Runtime guidance:** For day-to-day development patterns, refer
  to `AGENTS.md` and `CLAUDE.md` in the project root. This
  constitution governs *architecture*; those files govern *workflow*.

**Version**: 1.2.0 | **Ratified**: 2026-03-22 | **Last Amended**: 2026-03-24
