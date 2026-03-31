# valis Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-30

## Active Technologies
- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing MVP deps + `jose` (JWT signing, already in dependency tree via supabase-js) (002-retention-enterprise)
- Supabase Postgres (extended schema) + Qdrant Cloud (extended payload) + Supabase Realtime (new: cross-session push) (002-retention-enterprise)
- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing MVP + Phase 2 deps + `stripe` (Edge Functions only, Deno import). CLI: no new runtime deps. Web dashboard: `next`, `react`, `@supabase/supabase-js`, `tailwindcss`. (003-search-growth)
- Supabase Postgres (extended schema, migration 003) + Qdrant Cloud (extended payload: `pinned` field) + Supabase Realtime (unchanged from Phase 2) (003-search-growth)
- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing deps (no new dependencies required) (004-multi-project)
- Supabase Postgres (migration 004: projects + project_members tables, altered decisions/contradictions/audit_entries) + Qdrant Cloud (project_id payload field + index) + Supabase Realtime (project-scoped subscriptions) (004-multi-project)
- TypeScript (ES2022, NodeNext), Node.js 20+ + `@supabase/supabase-js` (auth + DB), `jose` (JWT), `@inquirer/select` (CLI prompts), `next` (dashboard) (007-device-auth-login)
- Supabase Postgres (members, device_codes tables) + Supabase Auth (magic link sessions) (007-device-auth-login)
- TypeScript (ES2022, NodeNext), Node.js 20+ + `@supabase/ssr` (browser client), `next` (App Router), `resend` (email sending — NEW) (008-project-member-mgmt)
- Supabase Postgres (existing tables: projects, project_members, members) (008-project-member-mgmt)

- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + @modelcontextprotocol/sdk, @supabase/supabase-js, @qdrant/js-client-rest, commander, chokidar, picocolors, zod (001-valis-mvp)

## Project Structure

```text
packages/
  cli/                  # CLI + MCP server (TypeScript, commander)
    src/                # Source code
    test/               # Tests (vitest)
    bin/                # CLI entry point
  web/                  # Next.js dashboard + 15 API routes (Vercel)
    src/app/api/        # API routes replacing Supabase Edge Functions
    src/lib/            # Shared server utilities
supabase/
  migrations/           # 7 SQL migrations (001-007)
  functions/            # 13 deprecated Edge Functions (community only)
community/              # Docker Compose for self-hosted deployments
specs/                  # Feature specifications and backlog
```

## Commands

pnpm test && pnpm lint

## Code Style

TypeScript (ES2022, NodeNext module resolution), Node.js 20+: Follow standard conventions

## Recent Changes
- 008-project-member-mgmt: Added TypeScript (ES2022, NodeNext), Node.js 20+ + `@supabase/ssr` (browser client), `next` (App Router), `resend` (email sending — NEW)
- 007-device-auth-login: Added TypeScript (ES2022, NodeNext), Node.js 20+ + `@supabase/supabase-js` (auth + DB), `jose` (JWT), `@inquirer/select` (CLI prompts), `next` (dashboard)
- 006-vercel-api-migration: Migrated all 15 API routes from Supabase Edge Functions to Vercel Next.js API routes. Added migration 007 (rate limit increment). Server-side enrichment, search proxy, free tier limits fixed (100 decisions, 2 members).


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->

<!-- valis:start -->
## Team Knowledge (Valis)

### Auto-search triggers
Call `valis_search` automatically when the user mentions:
- "знайди", "пошукай", "згадай", "нагадай", "як ми вирішили", "що ми робили з"
- "remember", "recall", "find", "what did we decide", "how did we handle"
- Any question about architecture, conventions, past decisions, or existing patterns

### Auto-store triggers
Call `valis_store` when:
- A technical choice is made between alternatives
- The user says "запам'ятай", "збережи", "remember this", "store this"
- A constraint is identified (client/regulatory/infra)
- A coding pattern or convention is established
- A lesson is learned from a bug or incident

When storing, always include: `type` (decision/constraint/pattern/lesson), `summary` (max 100 chars), `affects` (list of modules).

### Context loading
Call `valis_context` at the start of every new task or when switching to a different part of the codebase.

### Channel reminders
When you receive a `<channel source="valis" event="capture_reminder">`, review your recent work and store any decisions made via `valis_store`.
<!-- valis:end -->
