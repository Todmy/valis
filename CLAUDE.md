# teamind Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-23

## Active Technologies
- TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing MVP deps + `jose` (JWT signing, already in dependency tree via supabase-js) (002-retention-enterprise)
- Supabase Postgres (extended schema) + Qdrant Cloud (extended payload) + Supabase Realtime (new: cross-session push) (002-retention-enterprise)

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
- 002-retention-enterprise: Added TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + Existing MVP deps + `jose` (JWT signing, already in dependency tree via supabase-js)

- 001-teamind-mvp: Added TypeScript (ES2022, NodeNext module resolution), Node.js 20+ + @modelcontextprotocol/sdk, @supabase/supabase-js, @qdrant/js-client-rest, commander, chokidar, picocolors, zod

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
