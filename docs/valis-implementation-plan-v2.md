# Valis MVP Implementation Plan v2

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Valis MVP — shared decision intelligence for AI-augmented engineering teams. Cloud-first, three-layer auto-capture, zero native deps.

**Architecture:** Two packages: `cli` (MCP server + file watcher + stop hook + CLI commands + local enrichment) and `cloud` (Cloudflare Workers API + D1 + Qdrant Cloud + Cron + Queue). Three capture layers in one process. Haiku enrichment runs locally.

**Tech Stack:** Node.js + TypeScript, pnpm workspace, Hono (Cloudflare Workers), Cloudflare D1/KV/Queues, Qdrant Cloud, Claude Haiku, @modelcontextprotocol/sdk, chokidar

**Spec:** `/Users/todmy/PBaaS/research/decision-intelligence-platform/valis-design-spec-v3-final.md` (v4 in header)

**License:** Apache 2.0

**Timeline:** 8-10 weeks

---

## File Structure

```
valis/
├── packages/
│   ├── cli/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── bin/
│   │   │   └── valis.ts                 # CLI entry (#!/usr/bin/env node)
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── init.ts                # valis init + init --join
│   │   │   │   ├── serve.ts               # valis serve (launches unified process)
│   │   │   │   ├── status.ts              # valis status
│   │   │   │   ├── dashboard.ts           # valis dashboard
│   │   │   │   ├── export-cmd.ts          # valis export
│   │   │   │   ├── uninstall.ts           # valis uninstall
│   │   │   │   └── config-cmd.ts          # valis config set/get
│   │   │   ├── mcp/
│   │   │   │   ├── server.ts              # MCP server setup + tool registration
│   │   │   │   └── tools/
│   │   │   │       ├── store.ts           # valis_store handler
│   │   │   │       ├── search.ts          # valis_search handler
│   │   │   │       └── context.ts         # valis_context handler
│   │   │   ├── capture/
│   │   │   │   ├── watcher.ts             # JSONL file watcher (primary capture)
│   │   │   │   ├── hook-handler.ts        # Stop hook HTTP handler (secondary)
│   │   │   │   ├── startup-sweep.ts       # Process missed transcripts on startup
│   │   │   │   ├── transcript-parser.ts   # Parse JSONL lines, extract decisions
│   │   │   │   └── dedup.ts              # Content hash + session_id dedup
│   │   │   ├── enrichment/
│   │   │   │   └── haiku.ts               # Haiku client: classify + keywords
│   │   │   ├── cloud/
│   │   │   │   └── client.ts              # HTTP client for Valis Cloud API
│   │   │   ├── seed/
│   │   │   │   ├── index.ts               # Seed orchestrator
│   │   │   │   ├── parse-claude-md.ts     # Extract from CLAUDE.md
│   │   │   │   ├── parse-agents-md.ts     # Extract from AGENTS.md
│   │   │   │   ├── parse-cursorrules.ts   # Extract from .cursorrules
│   │   │   │   └── parse-git-log.ts       # Extract from git log
│   │   │   ├── ide/
│   │   │   │   ├── detect.ts              # Detect installed IDEs
│   │   │   │   ├── claude-code.ts         # Configure Claude Code MCP + hooks
│   │   │   │   ├── cursor.ts              # Configure Cursor MCP
│   │   │   │   └── codex.ts              # Configure Codex MCP
│   │   │   ├── security/
│   │   │   │   └── secrets.ts             # Secret detection patterns
│   │   │   ├── offline/
│   │   │   │   └── queue.ts               # pending.jsonl read/write/flush
│   │   │   ├── config/
│   │   │   │   ├── store.ts               # ~/.valis/config.json CRUD
│   │   │   │   └── manifest.ts            # Track what init created
│   │   │   ├── types.ts                   # Decision interface, API types
│   │   │   └── errors.ts                  # Error message constants
│   │   └── test/
│   │       ├── capture/
│   │       │   ├── watcher.test.ts
│   │       │   ├── transcript-parser.test.ts
│   │       │   └── dedup.test.ts
│   │       ├── mcp/tools/
│   │       │   ├── store.test.ts
│   │       │   ├── search.test.ts
│   │       │   └── context.test.ts
│   │       ├── enrichment/haiku.test.ts
│   │       ├── seed/parse-claude-md.test.ts
│   │       ├── security/secrets.test.ts
│   │       └── offline/queue.test.ts
│   └── cloud/
│       ├── package.json
│       ├── wrangler.toml
│       ├── src/
│       │   ├── index.ts                   # Hono app + cron + queue handlers
│       │   ├── routes/
│       │   │   ├── orgs.ts                # POST /orgs, POST join, GET members
│       │   │   ├── decisions.ts           # POST, PATCH, search, batch, dashboard
│       │   ├── middleware/
│       │   │   ├── auth.ts                # API key validation
│       │   │   └── rate-limit.ts          # KV counter enforcement
│       │   ├── services/
│       │   │   ├── qdrant.ts              # Qdrant Cloud client
│       │   │   └── haiku.ts               # Haiku for cron orphan enrichment
│       │   ├── queue/
│       │   │   └── seed-consumer.ts       # Queue: batch seed enrichment
│       │   ├── cron/
│       │   │   └── orphan-enrichment.ts   # Cron: re-enrich pending records
│       │   ├── db/
│       │   │   ├── schema.sql             # D1 DDL
│       │   │   └── queries.ts             # Typed query helpers
│       │   └── types.ts
│       └── test/
│           └── routes/
│               ├── orgs.test.ts
│               └── decisions.test.ts
├── LICENSE                                # Apache 2.0
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

---

## Build Order (8-10 weeks)

| Week | Chunk | Deliverable |
|------|-------|-------------|
| 1 | 1: Scaffold + Types | Monorepo, shared types, both packages compiling |
| 2-3 | 2: Cloud API | All 8 endpoints working on Cloudflare + Qdrant + D1 |
| 3-4 | 3: MCP Server + Cloud Client | 3 tools connected to cloud API, basic store/search/context |
| 4-5 | 4: Capture Layers | File watcher + stop hook + startup sweep + transcript parser + dedup |
| 5-6 | 5: Enrichment + Config | Haiku enrichment async + config management + manifest tracking |
| 6-7 | 6: CLI Commands | init + seed + serve + status + dashboard + export + uninstall |
| 7-8 | 7: IDE Setup + Security | Auto-detect IDEs + configure MCP + CLAUDE.md markers + secrets + offline queue |
| 8-9 | 8: Integration + Polish | End-to-end testing, error messages, edge cases, npm publish |
| 9-10 | 9: Beta | Dogfood + install for 3-5 consulting clients + iterate |

---

## Chunk 1: Scaffold + Shared Types (Week 1)

### Task 1.1: Initialize monorepo

**Files:** Create root package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, LICENSE (Apache 2.0)

- [ ] Create repo directory, git init
- [ ] Root package.json (private workspace)
- [ ] pnpm-workspace.yaml
- [ ] tsconfig.base.json (ES2022, NodeNext, strict)
- [ ] .gitignore (node_modules, dist, .wrangler, .dev.vars)
- [ ] LICENSE (Apache 2.0 full text)
- [ ] pnpm install + initial commit

### Task 1.2: CLI package + shared types

**Files:** packages/cli/package.json, tsconfig.json, src/types.ts, src/errors.ts

- [ ] CLI package.json (valis, bin entry, deps: @modelcontextprotocol/sdk, @anthropic-ai/sdk, commander, chokidar, picocolors, zod)
- [ ] CLI tsconfig.json (extends base)
- [ ] src/types.ts — Decision interface, RawDecision, EnrichmentResult, API response types, ValisConfig
- [ ] src/errors.ts — All 7 error message constants from spec Section 13
- [ ] pnpm install + build + commit

### Task 1.3: Cloud package scaffold

**Files:** packages/cloud/package.json, wrangler.toml, src/index.ts, src/types.ts, src/db/schema.sql

- [ ] Cloud package.json (hono, @cloudflare/workers-types, wrangler)
- [ ] wrangler.toml (D1, KV, Queues, Cron bindings)
- [ ] src/db/schema.sql — orgs, members tables with indexes
- [ ] src/index.ts — Hono app skeleton with health endpoint
- [ ] src/types.ts — Mirror Decision types for cloud
- [ ] pnpm install + commit

---

## Chunk 2: Cloud API (Weeks 2-3)

### Task 2.1: D1 query helpers + org endpoints

**Files:** src/db/queries.ts, src/routes/orgs.ts

- [ ] generateId(), generateApiKey(), generateInviteCode() helpers
- [ ] createOrg() — INSERT org + first member (admin)
- [ ] joinOrg() — validate invite code, check member limit, INSERT member
- [ ] getOrgByApiKey() — for auth middleware
- [ ] POST /orgs (unauthenticated) — create org
- [ ] POST /orgs/:id/join (unauthenticated) — join with invite code
- [ ] GET /orgs/:id/members (authenticated)
- [ ] Test with wrangler dev + curl
- [ ] Commit

### Task 2.2: Auth middleware + rate limiting

**Files:** src/middleware/auth.ts, src/middleware/rate-limit.ts

- [ ] Auth middleware — extract Bearer token, validate against D1, attach org context
- [ ] Rate limit middleware — KV counter per org per day, check against plan limits
- [ ] Apply to protected routes
- [ ] Commit

### Task 2.3: Qdrant service + decisions CRUD

**Files:** src/services/qdrant.ts, src/routes/decisions.ts

- [ ] QdrantService class — ensureCollection, upsertDecision, updatePayload, search, scrollByFilter, getDashboardStats
- [ ] Single collection "decisions" with org_id indexed payload field
- [ ] POST /orgs/:id/decisions — store raw text
- [ ] PATCH /orgs/:id/decisions/:did — update enriched fields
- [ ] POST /orgs/:id/decisions/search — hybrid search
- [ ] POST /orgs/:id/decisions/batch — bulk store for seed, enqueue enrichment
- [ ] GET /orgs/:id/dashboard — aggregated stats
- [ ] Test against Qdrant Cloud
- [ ] Commit

### Task 2.4: Cron + Queue

**Files:** src/cron/orphan-enrichment.ts, src/services/haiku.ts, src/queue/seed-consumer.ts

- [ ] Haiku client for cloud (Valis's own key) — enrichDecision()
- [ ] Cron handler — query pending records older than 2 min, enrich, update
- [ ] Queue consumer — process seed batch messages, enrich each decision
- [ ] Wire into index.ts (scheduled + queue handlers)
- [ ] Deploy to Cloudflare
- [ ] Commit

---

## Chunk 3: MCP Server + Cloud Client (Weeks 3-4)

### Task 3.1: Cloud API client

**Files:** src/cloud/client.ts

- [ ] ValisCloudClient class — storeDecision, updateDecision, searchDecisions, batchStore, getDashboard, healthCheck
- [ ] 5s timeout on all requests
- [ ] Commit

### Task 3.2: MCP tools (store, search, context)

**Files:** src/mcp/server.ts, src/mcp/tools/store.ts, search.ts, context.ts, src/security/secrets.ts, src/offline/queue.ts

- [ ] Secret detection — 10 regex patterns, returns pattern name or null
- [ ] Offline queue — appendFileSync to pending.jsonl, read/clear/count helpers
- [ ] valis_store — validate → secret check → store to cloud (or queue offline) → async enrich → return
- [ ] valis_search — call cloud API → format results → return
- [ ] valis_context — search by task description + file names → format grouped by type → return
- [ ] MCP server entry — register 3 tools with descriptions from spec, stdio transport
- [ ] Test with MCP Inspector
- [ ] Commit

---

## Chunk 4: Capture Layers (Weeks 4-5)

This is the core differentiator — three capture layers in one process.

### Task 4.1: Transcript parser

**Files:** src/capture/transcript-parser.ts

- [ ] parseJsonlLine() — handle all line types (user, assistant, system, progress, result, file-history-snapshot)
- [ ] extractDecisionCandidates() — from assistant messages, find text that looks like decisions/constraints/patterns
- [ ] Filter: skip tool results, progress events, short responses (<50 chars), debugging back-and-forth
- [ ] Return: array of {text, session_id, timestamp, source: 'auto_capture'}
- [ ] Test with real JSONL from ~/.claude/projects/
- [ ] Commit

### Task 4.2: Content deduplication

**Files:** src/capture/dedup.ts

- [ ] contentHash() — SHA-256 of normalized text (lowercase, trim, collapse whitespace)
- [ ] isDuplicate() — check hash against recent hashes in memory (LRU cache, 1000 entries)
- [ ] Also check session_id — same session = likely same context, higher dedup threshold
- [ ] Test: two similar texts → detected as duplicate. Two different texts → not duplicate.
- [ ] Commit

### Task 4.3: JSONL file watcher (primary capture)

**Files:** src/capture/watcher.ts

- [ ] WatcherState — track byte offset per file in ~/.valis/watcher-state.json
- [ ] startWatcher() — chokidar.watch('~/.claude/projects/**/*.jsonl', {depth: 2, awaitWriteFinish: {stabilityThreshold: 300}})
- [ ] On file change: read from last offset → split by \n → skip incomplete last line → parse each → extract candidates → dedup → store to cloud → enrich async → update offset
- [ ] Handle: partial lines (buffer incomplete), non-conversation lines (skip), subagent files
- [ ] Graceful degradation: if watch fails, log warning, continue with MCP-only capture
- [ ] Test: append to a test JSONL file → verify watcher picks up new lines
- [ ] Commit

### Task 4.4: Stop hook HTTP handler (secondary capture)

**Files:** src/capture/hook-handler.ts

- [ ] Start HTTP server on random available port (localhost only)
- [ ] POST /hook/stop — receives {transcript_path, session_id, ...}
- [ ] Read transcript file → parse all lines → extract decision candidates → dedup → batch store to cloud → enrich
- [ ] If transcript_path is stale (mtime > 5 min old): find newest .jsonl by mtime as fallback
- [ ] Return 200 quickly (process async via setImmediate)
- [ ] Register port in ~/.valis/hook-port for init to configure
- [ ] Test: POST fake hook payload → verify extraction
- [ ] Commit

### Task 4.5: Startup sweep

**Files:** src/capture/startup-sweep.ts

- [ ] sweepUnprocessedTranscripts() — called before MCP loop starts
- [ ] Load watcher state (last processed offset per file)
- [ ] Glob ~/.claude/projects/**/*.jsonl
- [ ] For each file: if mtime > last processed → read new content → extract → store → update state
- [ ] Also flush offline queue (pending.jsonl) if cloud is reachable
- [ ] Log: "Processed N unread transcripts, extracted M decisions"
- [ ] Test: create test JSONL with known content → run sweep → verify decisions stored
- [ ] Commit

### Task 4.6: Integrate all capture layers into serve

**Files:** src/commands/serve.ts (update)

- [ ] serve command flow:
  1. Load config
  2. Run startup sweep (async, don't block)
  3. Start file watcher (background)
  4. Start stop hook HTTP handler (background)
  5. Start MCP server (blocks — enters stdio event loop)
  6. On process exit: save watcher state, cleanup
- [ ] All three layers running in same Node.js process
- [ ] Test: start serve → create test transcript → verify auto-captured
- [ ] Commit

---

## Chunk 5: Enrichment + Config (Weeks 5-6)

### Task 5.1: Haiku enrichment (local, async)

**Files:** src/enrichment/haiku.ts

- [ ] enrichWithHaiku() — call Anthropic API with extraction prompt from spec
- [ ] 5s timeout — if fails, record stays pending (cron retries)
- [ ] Parse JSON response — validate required fields (type, summary, search_keywords)
- [ ] PATCH enriched fields to cloud via client.updateDecision()
- [ ] Handle: malformed JSON (retry once), rate limit (log, skip), invalid API key (log error message)
- [ ] Test with mock Anthropic API
- [ ] Commit

### Task 5.2: Config + manifest management

**Files:** src/config/store.ts, src/config/manifest.ts

- [ ] loadConfig/saveConfig/updateConfig — ~/.valis/config.json with 0600 permissions
- [ ] loadManifest/saveManifest/trackFile — ~/.valis/manifest.json tracks all modified files
- [ ] Commit

---

## Chunk 6: CLI Commands (Weeks 6-7)

### Task 6.1: valis init

**Files:** src/commands/init.ts, src/ide/detect.ts, src/ide/claude-code.ts, src/ide/cursor.ts, src/ide/codex.ts, src/seed/index.ts, src/seed/parse-*.ts

- [ ] Interactive prompts: create org vs join, org name, API key (optional)
- [ ] Create org via cloud API → save config
- [ ] Or join org → save config
- [ ] Detect installed IDEs
- [ ] Configure MCP for each IDE (JSON merge, atomic writes)
- [ ] Configure Claude Code stop hook (write to settings.json hooks section)
- [ ] Inject CLAUDE.md instructions (<!-- valis:start/end --> markers)
- [ ] Set cleanupPeriodDays: 99999 in Claude Code settings
- [ ] Seed: parse CLAUDE.md + AGENTS.md + .cursorrules + git log → batch store to cloud
- [ ] Verification: store test decision → search → confirm
- [ ] Print invite code + next steps
- [ ] Commit

### Task 6.2: valis serve

Already built in Chunk 4.6 — verify it works end-to-end.

### Task 6.3: valis status

**Files:** src/commands/status.ts

- [ ] Check cloud connectivity (healthCheck)
- [ ] Check API key validity (if configured)
- [ ] Show decision count from dashboard endpoint
- [ ] Show pending enrichments
- [ ] Show watcher status (watching N files, last activity)
- [ ] Commit

### Task 6.4: valis dashboard

**Files:** src/commands/dashboard.ts

- [ ] Call getDashboard from cloud
- [ ] Format: colored terminal output with picocolors
- [ ] Show: total decisions, by type, by status, top contributors, recent 5, pending enrichment
- [ ] Commit

### Task 6.5: valis export

**Files:** src/commands/export-cmd.ts

- [ ] --json: fetch all decisions → write valis-export-{date}.json
- [ ] --markdown: fetch all → group by type → write valis-export-{date}.md
- [ ] Commit

### Task 6.6: valis uninstall

**Files:** src/commands/uninstall.ts

- [ ] Read manifest.json
- [ ] Remove MCP configs from each IDE (surgical JSON edit)
- [ ] Remove CLAUDE.md markers
- [ ] Remove hook configs
- [ ] Print: "Cloud data remains in org. Run valis org leave to remove."
- [ ] Delete ~/.valis/ directory
- [ ] Commit

### Task 6.7: valis config

**Files:** src/commands/config-cmd.ts

- [ ] valis config set api-key <key> → validate → save
- [ ] valis config get api-key → print (masked)
- [ ] valis config set author-name <name>
- [ ] Commit

### Task 6.8: CLI entry point

**Files:** bin/valis.ts

- [ ] Commander setup with all commands
- [ ] Build + test: valis --version, valis --help, valis serve --help
- [ ] Commit

---

## Chunk 7: IDE Setup + Security (Weeks 7-8)

### Task 7.1: IDE auto-detection

- [ ] detect.ts: check for ~/.claude/, .cursor/, .codex/ directories
- [ ] Return list of detected IDEs with config file paths

### Task 7.2: Claude Code configuration

- [ ] Write MCP server entry to settings.json (JSON merge)
- [ ] Write stop hook config (HTTP handler URL with port)
- [ ] Set cleanupPeriodDays: 99999

### Task 7.3: Cursor + Codex configuration

- [ ] Cursor: write to .cursor/mcp.json
- [ ] Codex: write to .codex/config.toml or mcp config
- [ ] Add .cursorrules / AGENTS.md instructions

### Task 7.4: CLAUDE.md marker injection

- [ ] No CLAUDE.md → create with valis block
- [ ] Exists in project → append between <!-- valis:start/end -->
- [ ] Exists in parent only → create new project-level
- [ ] Markers exist → replace content between them

### Task 7.5: Secret detection tests

- [ ] Test all 10 patterns with real examples
- [ ] Test false negatives (should NOT block)
- [ ] Test false positives (legitimate text that looks like secrets)

---

## Chunk 8: Integration + Polish (Weeks 8-9)

### Task 8.1: End-to-end test

- [ ] Deploy cloud to Cloudflare
- [ ] npm install -g from packages/cli
- [ ] valis init → create org → seed
- [ ] Open Claude Code → file watcher captures decisions
- [ ] Test valis_store, valis_search, valis_context
- [ ] Test stop hook fires on session end
- [ ] valis dashboard → verify stats
- [ ] valis export --json → verify output
- [ ] valis uninstall → verify clean removal

### Task 8.2: Verify acceptance criteria

- [ ] AC1: npm install succeeds on macOS ARM64/Intel, Linux x64 — zero native compilation
- [ ] AC2: valis init creates org + seeds + configures in <3 minutes
- [ ] AC3: Dev A stores → Dev B on different machine finds it
- [ ] AC4: Seed extracts 15+ decisions, init returns <10s (enrichment async)
- [ ] AC5: Haiku enrichment produces type + keywords for >80% within 5 min
- [ ] AC6: Search "authentication" finds JWT decision (via keywords)
- [ ] AC7: Dashboard shows team activity
- [ ] AC8: Export produces valid JSON
- [ ] AC9: Uninstall removes all configs, mentions cloud data
- [ ] AC10: Offline: store queues, search returns empty gracefully
- [ ] AC11: Secret detection blocks known patterns
- [ ] AC12: File watcher captures decisions from transcripts automatically

### Task 8.3: README + AGENTS.md + npm publish

- [ ] README.md — install, quickstart (30 seconds), features, how it works, pricing link
- [ ] AGENTS.md — Valis eats its own dogfood
- [ ] npm publish from packages/cli
- [ ] Commit + tag v0.1.0

---

## Chunk 9: Beta (Weeks 9-10)

### Task 9.1: Dogfood

- [ ] Install on own team/projects
- [ ] Use for 1 week
- [ ] Track: decisions captured, search quality, edge cases

### Task 9.2: Install for 3-5 consulting clients

- [ ] Identify clients using AI agents daily
- [ ] Install during consulting engagement
- [ ] Gather feedback: what works, what breaks, what's missing
- [ ] Iterate

### Task 9.3: Public launch prep

- [ ] Show HN post draft
- [ ] Product Hunt listing
- [ ] LinkedIn post (from GTM hooks in spec)
- [ ] Submit to MCP directories (mcpmarket.com, pulsemcp.com)

---

## Key Risks During Implementation

| Risk | When | Mitigation |
|------|------|-----------|
| JSONL transcript format changes | Chunk 4 | Version-aware parser, graceful degradation |
| Qdrant Cloud free tier limits hit | Chunk 2 | Monitor usage, use MiniLM 384d (4x capacity) |
| Haiku extraction quality <60% | Chunk 5 | Run extraction-quality-test.md before writing final prompt |
| File watcher CPU/memory on large dirs | Chunk 4 | Watch directories only (depth: 2), not individual files |
| chokidar reliability on macOS | Chunk 4 | Consider native fs.watch with recursive: true (Node 19+) |
| Multiple serve processes = duplicate captures | Chunk 4 | Dedup by content hash + session_id |
| Cloud API latency >500ms for search | Chunk 3 | Connection warming on startup, accept latency |
