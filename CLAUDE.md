# teamind Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-24

## Active Technologies
- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing MVP deps + `jose` (JWT signing, already in dependency tree via supabase-js) (002-retention-enterprise)
- Supabase Postgres (extended schema) + Qdrant Cloud (extended payload) + Supabase Realtime (new: cross-session push) (002-retention-enterprise)
- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing MVP + Phase 2 deps + `stripe` (Edge Functions only, Deno import). CLI: no new runtime deps. Web dashboard: `next`, `react`, `@supabase/supabase-js`, `tailwindcss`. (003-search-growth)
- Supabase Postgres (extended schema, migration 003) + Qdrant Cloud (extended payload: `pinned` field) + Supabase Realtime (unchanged from Phase 2) (003-search-growth)

- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + @modelcontextprotocol/sdk, @supabase/supabase-js, @qdrant/js-client-rest, commander, chokidar, picocolors, zod (001-teamind-mvp)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript (ES2022, NodeNext module resolution), Node.js 20+: Follow standard conventions

## Recent Changes
- 003-search-growth: Added TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing MVP + Phase 2 deps + `stripe` (Edge Functions only, Deno import). CLI: no new runtime deps. Web dashboard: `next`, `react`, `@supabase/supabase-js`, `tailwindcss`.
- 002-retention-enterprise: Added TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing MVP deps + `jose` (JWT signing, already in dependency tree via supabase-js)

- 001-teamind-mvp: Added TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + @modelcontextprotocol/sdk, @supabase/supabase-js, @qdrant/js-client-rest, commander, chokidar, picocolors, zod

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
