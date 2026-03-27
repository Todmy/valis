# valis Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-24

## Active Technologies
- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing MVP deps + `jose` (JWT signing, already in dependency tree via supabase-js) (002-retention-enterprise)
- Supabase Postgres (extended schema) + Qdrant Cloud (extended payload) + Supabase Realtime (new: cross-session push) (002-retention-enterprise)
- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing MVP + Phase 2 deps + `stripe` (Edge Functions only, Deno import). CLI: no new runtime deps. Web dashboard: `next`, `react`, `@supabase/supabase-js`, `tailwindcss`. (003-search-growth)
- Supabase Postgres (extended schema, migration 003) + Qdrant Cloud (extended payload: `pinned` field) + Supabase Realtime (unchanged from Phase 2) (003-search-growth)
- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing deps (no new dependencies required) (004-multi-project)
- Supabase Postgres (migration 004: projects + project_members tables, altered decisions/contradictions/audit_entries) + Qdrant Cloud (project_id payload field + index) + Supabase Realtime (project-scoped subscriptions) (004-multi-project)

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
- 006-vercel-api-migration: Migrated all 15 API routes from Supabase Edge Functions to Vercel Next.js API routes. Added migration 007 (rate limit increment). Server-side enrichment, search proxy, free tier limits fixed (100 decisions, 2 members).
- 005-registration-api: Zero-config onboarding via public `/api/register` endpoint. Atomic org + project + member creation.
- 004-multi-project: Project-scoped isolation with `projects` and `project_members` tables, Qdrant `project_id` payload field.
- 003-search-growth: Search intelligence (reranking, query analysis, graph search, HyPE indexing), billing (Stripe), decision cleanup and synthesis, knowledge compression.
- 002-retention-enterprise: Decision lifecycle, cross-session push, per-member JWT auth, contradiction detection, platform metrics, audit trail.


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
