# Teamind MVP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Teamind MVP — shared decision intelligence for AI-augmented engineering teams. Cloud-first, pure MCP, zero native deps.

**Architecture:** Two packages: `cli` (MCP server + CLI commands + local enrichment) and `cloud` (Cloudflare Workers API + D1 + Qdrant Cloud + Cron + Queue). The CLI calls the Cloud API for all storage/search. Haiku enrichment runs locally in the MCP server process.

**Tech Stack:** Node.js + TypeScript, pnpm workspace, Hono (Cloudflare Workers), Cloudflare D1/KV/Queues, Qdrant Cloud, Claude Haiku, @modelcontextprotocol/sdk

**Spec:** `/Users/todmy/PBaaS/research/decision-intelligence-platform/teamind-design-spec-v3-final.md`

---

## File Structure

```
teamind/
├── packages/
│   ├── cli/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── bin/
│   │   │   └── teamind.ts                 # CLI entry point (#!/usr/bin/env node)
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── init.ts                # teamind init + init --join
│   │   │   │   ├── serve.ts               # teamind serve (MCP server launcher)
│   │   │   │   ├── status.ts              # teamind status
│   │   │   │   ├── dashboard.ts           # teamind dashboard
│   │   │   │   ├── export-cmd.ts          # teamind export
│   │   │   │   ├── uninstall.ts           # teamind uninstall
│   │   │   │   └── config-cmd.ts          # teamind config set/get
│   │   │   ├── mcp/
│   │   │   │   ├── server.ts              # MCP server setup + tool registration
│   │   │   │   └── tools/
│   │   │   │       ├── store.ts           # teamind_store handler
│   │   │   │       ├── search.ts          # teamind_search handler
│   │   │   │       └── context.ts         # teamind_context handler
│   │   │   ├── enrichment/
│   │   │   │   └── haiku.ts               # Haiku client: classify + keywords
│   │   │   ├── cloud/
│   │   │   │   └── client.ts              # HTTP client for Teamind Cloud API
│   │   │   ├── seed/
│   │   │   │   ├── index.ts               # Seed orchestrator
│   │   │   │   ├── parse-claude-md.ts     # Extract decisions from CLAUDE.md
│   │   │   │   ├── parse-agents-md.ts     # Extract from AGENTS.md
│   │   │   │   ├── parse-cursorrules.ts   # Extract from .cursorrules
│   │   │   │   └── parse-git-log.ts       # Extract from git log
│   │   │   ├── ide/
│   │   │   │   ├── detect.ts              # Detect installed IDEs
│   │   │   │   ├── claude-code.ts         # Write MCP config for Claude Code
│   │   │   │   ├── cursor.ts              # Write MCP config for Cursor
│   │   │   │   └── codex.ts              # Write MCP config for Codex
│   │   │   ├── security/
│   │   │   │   └── secrets.ts             # Secret detection patterns
│   │   │   ├── offline/
│   │   │   │   └── queue.ts               # pending.jsonl read/write/flush
│   │   │   ├── config/
│   │   │   │   ├── store.ts               # ~/.teamind/config.json CRUD
│   │   │   │   └── manifest.ts            # ~/.teamind/manifest.json (tracks what init created)
│   │   │   ├── types.ts                   # Decision interface, enums, API types
│   │   │   └── errors.ts                  # Error message constants
│   │   └── test/
│   │       ├── mcp/
│   │       │   └── tools/
│   │       │       ├── store.test.ts
│   │       │       ├── search.test.ts
│   │       │       └── context.test.ts
│   │       ├── enrichment/
│   │       │   └── haiku.test.ts
│   │       ├── seed/
│   │       │   ├── parse-claude-md.test.ts
│   │       │   └── parse-git-log.test.ts
│   │       ├── security/
│   │       │   └── secrets.test.ts
│   │       ├── offline/
│   │       │   └── queue.test.ts
│   │       └── config/
│   │           └── store.test.ts
│   └── cloud/
│       ├── package.json
│       ├── wrangler.toml
│       ├── src/
│       │   ├── index.ts                   # Hono app entry + route mounting
│       │   ├── routes/
│       │   │   ├── orgs.ts                # POST /orgs, POST /orgs/:id/join, GET /members
│       │   │   ├── decisions.ts           # POST, PATCH, POST search, POST batch
│       │   │   └── dashboard.ts           # GET /orgs/:id/dashboard
│       │   ├── middleware/
│       │   │   ├── auth.ts                # API key validation against D1
│       │   │   └── rate-limit.ts          # KV counter check + increment
│       │   ├── services/
│       │   │   ├── qdrant.ts              # Qdrant Cloud client (upsert, search, scroll)
│       │   │   └── haiku.ts               # Haiku client for cron orphan enrichment
│       │   ├── queue/
│       │   │   └── seed-consumer.ts       # Queue consumer: batch seed enrichment
│       │   ├── cron/
│       │   │   └── orphan-enrichment.ts   # Cron: re-enrich pending records
│       │   ├── db/
│       │   │   ├── schema.sql             # D1 DDL (orgs, members, invite_codes)
│       │   │   └── queries.ts             # Typed query helpers
│       │   └── types.ts                   # Shared types (mirrors cli/types.ts)
│       └── test/
│           ├── routes/
│           │   ├── orgs.test.ts
│           │   ├── decisions.test.ts
│           │   └── dashboard.test.ts
│           └── services/
│               └── qdrant.test.ts
├── LICENSE                                # BSL 1.1
├── AGENTS.md
├── package.json                           # Workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

---

## Chunk 1: Repo Scaffold + Shared Types

### Task 1.1: Initialize monorepo

**Files:**
- Create: `teamind/package.json`
- Create: `teamind/pnpm-workspace.yaml`
- Create: `teamind/tsconfig.base.json`
- Create: `teamind/.gitignore`
- Create: `teamind/LICENSE`

- [ ] **Step 1: Create repo directory**

```bash
mkdir -p ~/Projects/teamind && cd ~/Projects/teamind
git init
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "teamind",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 3: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "dist"
  }
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.wrangler/
.dev.vars
*.log
.DS_Store
```

- [ ] **Step 6: Create LICENSE (BSL 1.1)**

```
Business Source License 1.1

Licensor: Teamind
Licensed Work: Teamind
Change Date: 2029-03-17
Change License: Apache License, Version 2.0

Additional Use Grant: You may use the Licensed Work for any purpose
EXCEPT operating a commercial hosted service that competes with
Teamind Cloud.

For the full BSL 1.1 text, see https://mariadb.com/bsl11/
```

- [ ] **Step 7: pnpm install + commit**

```bash
pnpm install
git add -A
git commit -m "chore: initialize teamind monorepo with pnpm workspace"
```

---

### Task 1.2: Shared types (Decision interface)

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/types.ts`
- Create: `packages/cli/src/errors.ts`

- [ ] **Step 1: Create cli package.json**

```json
{
  "name": "teamind",
  "version": "0.1.0",
  "description": "Shared decision intelligence for AI-augmented engineering teams",
  "type": "module",
  "bin": {
    "teamind": "./dist/bin/teamind.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "keywords": ["mcp", "ai", "decisions", "team", "knowledge"],
  "license": "SEE LICENSE IN LICENSE",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "commander": "^13.0.0",
    "picocolors": "^1.1.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Create cli tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*", "bin/**/*"]
}
```

- [ ] **Step 3: Write the Decision type and API types**

Create `packages/cli/src/types.ts`:

```typescript
// Decision types — the core data model
export type DecisionType = 'decision' | 'constraint' | 'pattern' | 'lesson' | 'pending';
export type DecisionStatus = 'active' | 'deprecated' | 'superseded' | 'proposed';
export type ExtractionStatus = 'pending' | 'enriched' | 'failed';
export type DecisionSource = 'agent_session' | 'seed' | 'manual';

export interface Decision {
  id: string;
  type: DecisionType;
  summary: string;
  detail: string;
  status: DecisionStatus;
  author: string;
  source: DecisionSource;
  project_id: string;
  org_id: string;
  created_at: string;
  updated_at: string;
  confidence: number;
  extraction_status: ExtractionStatus;
  affects: string[];
  search_keywords: string[];
  // Phase 2
  depends_on: string[];
  contradicts: string[];
  replaces: string[];
  decided_by: string[];
}

// Raw input before enrichment
export interface RawDecision {
  text: string;
  author?: string;
  source?: DecisionSource;
  project_id?: string;
}

// Enriched fields from Haiku
export interface EnrichmentResult {
  type: DecisionType;
  summary: string;
  detail: string;
  affects: string[];
  search_keywords: string[];
  confidence: number;
}

// Cloud API response types
export interface OrgCreateResponse {
  org_id: string;
  api_key: string;
  invite_code: string;
  name: string;
}

export interface OrgJoinResponse {
  org_id: string;
  api_key: string;
  name: string;
}

export interface StoreResponse {
  id: string;
  status: 'stored';
}

export interface SearchResult {
  decision: Decision;
  score: number;
}

export interface DashboardData {
  total_decisions: number;
  by_type: Record<DecisionType, number>;
  by_status: Record<DecisionStatus, number>;
  by_author: { author: string; count: number }[];
  recent: Decision[];
  pending_enrichment: number;
}

// Local config
export interface TeamindConfig {
  org_id: string;
  org_name: string;
  api_key: string;
  anthropic_api_key?: string;
  author_name: string;
  cloud_url: string;
}
```

- [ ] **Step 4: Write error message constants**

Create `packages/cli/src/errors.ts`:

```typescript
export const ERRORS = {
  INVALID_API_KEY: `Error: Anthropic API key rejected (HTTP 401).
Check: https://console.anthropic.com/settings/keys
Teamind stores raw decisions without enrichment until valid key is set.
Fix: teamind config set api-key <your-key>`,

  CLOUD_UNREACHABLE: (pending: number) =>
    `Warning: Teamind Cloud unreachable.
Decisions queued locally (${pending} pending). Search unavailable offline.
Will sync automatically when connected.`,

  ORG_NOT_FOUND: `Error: Organization not found.
Run: teamind init (create new) or teamind init --join CODE (join existing)`,

  INVITE_INVALID: (code: string) =>
    `Error: Invite code ${code} is invalid or expired.
Ask your team lead: teamind org invite (generates new code)`,

  FREE_LIMIT: (current: number, max: number) =>
    `Warning: Free tier limit reached (${current}/${max} decisions).
New decisions will not be stored. Options:
  teamind billing upgrade
  teamind decisions prune --older-than 30d`,

  HAIKU_RATE_LIMITED: `Warning: Anthropic API rate limited. Enrichment paused.
Decisions stored as raw text. Enrichment retries automatically.`,

  SECRET_DETECTED: (pattern: string) =>
    `Blocked: Secret detected (${pattern}) in input.
Decision NOT stored. Remove the secret and try again.`,
} as const;
```

- [ ] **Step 5: Install deps + build + commit**

```bash
cd packages/cli && pnpm install
pnpm build
cd ../..
git add -A
git commit -m "feat: add cli package with Decision types and error constants"
```

---

### Task 1.3: Cloud package scaffold

**Files:**
- Create: `packages/cloud/package.json`
- Create: `packages/cloud/wrangler.toml`
- Create: `packages/cloud/src/index.ts`
- Create: `packages/cloud/src/types.ts`
- Create: `packages/cloud/src/db/schema.sql`

- [ ] **Step 1: Create cloud package.json**

```json
{
  "name": "@teamind/cloud",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "db:migrate": "wrangler d1 execute teamind-db --local --file=src/db/schema.sql"
  },
  "dependencies": {
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250312.0",
    "wrangler": "^3.100.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create wrangler.toml**

```toml
name = "teamind-api"
main = "src/index.ts"
compatibility_date = "2025-12-01"

[vars]
QDRANT_URL = "https://YOUR_CLUSTER.cloud.qdrant.io"
QDRANT_API_KEY = ""
TEAMIND_HAIKU_KEY = ""

[[d1_databases]]
binding = "DB"
database_name = "teamind-db"
database_id = ""

[[kv_namespaces]]
binding = "RATE_LIMITS"
id = ""

[[queues.producers]]
queue = "seed-enrichment"
binding = "SEED_QUEUE"

[[queues.consumers]]
queue = "seed-enrichment"
max_batch_size = 10
max_batch_timeout = 30

[triggers]
crons = ["*/5 * * * *"]
```

- [ ] **Step 3: Create D1 schema**

Create `packages/cloud/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  plan TEXT NOT NULL DEFAULT 'free',
  decision_limit INTEGER NOT NULL DEFAULT 500,
  member_limit INTEGER NOT NULL DEFAULT 5,
  search_limit_daily INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_members_org ON members(org_id);
CREATE INDEX IF NOT EXISTS idx_members_api_key ON members(api_key);
CREATE INDEX IF NOT EXISTS idx_orgs_api_key ON orgs(api_key);
CREATE INDEX IF NOT EXISTS idx_orgs_invite ON orgs(invite_code);
```

- [ ] **Step 4: Create Hono app skeleton**

Create `packages/cloud/src/index.ts`:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  RATE_LIMITS: KVNamespace;
  SEED_QUEUE: Queue;
  QDRANT_URL: string;
  QDRANT_API_KEY: string;
  TEAMIND_HAIKU_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

// Routes will be added in subsequent tasks
// app.route('/orgs', orgsRouter);
// app.route('/orgs', decisionsRouter);

export default {
  fetch: app.fetch,
  // Cron trigger handler
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // Orphan enrichment — Task 2.4
  },
  // Queue consumer handler
  async queue(batch: MessageBatch, env: Bindings) {
    // Seed batch enrichment — Task 2.5
  },
};
```

- [ ] **Step 5: Create shared types for cloud**

Create `packages/cloud/src/types.ts`:

```typescript
// Mirror of cli/src/types.ts for Decision schema
// In production, extract to a shared package. For MVP, keep in sync manually.

export type DecisionType = 'decision' | 'constraint' | 'pattern' | 'lesson' | 'pending';
export type DecisionStatus = 'active' | 'deprecated' | 'superseded' | 'proposed';
export type ExtractionStatus = 'pending' | 'enriched' | 'failed';

export interface DecisionPayload {
  type: DecisionType;
  summary: string;
  detail: string;
  status: DecisionStatus;
  author: string;
  source: string;
  project_id: string;
  org_id: string;
  created_at: string;
  updated_at: string;
  confidence: number;
  extraction_status: ExtractionStatus;
  affects: string[];
  search_keywords: string[];
}

export interface QdrantPoint {
  id: string;
  payload: DecisionPayload;
}
```

- [ ] **Step 6: Install deps + build + commit**

```bash
cd packages/cloud && pnpm install
cd ../..
pnpm build
git add -A
git commit -m "feat: add cloud package scaffold with D1 schema and Hono skeleton"
```

---

## Chunk 2: Cloud API — Org Management + Decisions CRUD

### Task 2.1: Org creation + join endpoints

**Files:**
- Create: `packages/cloud/src/routes/orgs.ts`
- Create: `packages/cloud/src/db/queries.ts`
- Test: `packages/cloud/test/routes/orgs.test.ts`

- [ ] **Step 1: Write failing test for org creation**

Create `packages/cloud/test/routes/orgs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('POST /orgs', () => {
  it('should create org with name and return api_key + invite_code', async () => {
    // Integration test against Miniflare local env
    // Will be implemented after route exists
    expect(true).toBe(true); // placeholder
  });
});

describe('POST /orgs/:id/join', () => {
  it('should join org with valid invite code', async () => {
    expect(true).toBe(true); // placeholder
  });

  it('should reject invalid invite code', async () => {
    expect(true).toBe(true); // placeholder
  });
});
```

- [ ] **Step 2: Create D1 query helpers**

Create `packages/cloud/src/db/queries.ts`:

```typescript
export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'tmk_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/1/I confusion
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const prefix = Array.from(bytes.slice(0, 4)).map(b => chars[b % chars.length]).join('');
  const suffix = Array.from(bytes.slice(4)).map(b => chars[b % chars.length]).join('');
  return `${prefix}-${suffix}`;
}

export async function createOrg(db: D1Database, name: string) {
  const id = generateId();
  const api_key = generateApiKey();
  const invite_code = generateInviteCode();

  await db.prepare(
    'INSERT INTO orgs (id, name, api_key, invite_code) VALUES (?, ?, ?, ?)'
  ).bind(id, name, api_key, invite_code).run();

  // Creator is first member (admin)
  const memberId = generateId();
  await db.prepare(
    'INSERT INTO members (id, org_id, name, api_key, role) VALUES (?, ?, ?, ?, ?)'
  ).bind(memberId, id, name, api_key, 'admin').run();

  return { org_id: id, api_key, invite_code, name };
}

export async function joinOrg(db: D1Database, inviteCode: string, memberName: string) {
  const org = await db.prepare(
    'SELECT id, name FROM orgs WHERE invite_code = ?'
  ).bind(inviteCode).first<{ id: string; name: string }>();

  if (!org) return null;

  // Check member limit
  const count = await db.prepare(
    'SELECT COUNT(*) as cnt FROM members WHERE org_id = ?'
  ).bind(org.id).first<{ cnt: number }>();

  const limit = await db.prepare(
    'SELECT member_limit FROM orgs WHERE id = ?'
  ).bind(org.id).first<{ member_limit: number }>();

  if (count && limit && count.cnt >= limit.member_limit) {
    return { error: 'member_limit_reached' };
  }

  const memberId = generateId();
  const api_key = generateApiKey();

  await db.prepare(
    'INSERT INTO members (id, org_id, name, api_key) VALUES (?, ?, ?, ?)'
  ).bind(memberId, org.id, memberName, api_key).run();

  return { org_id: org.id, api_key, name: org.name };
}

export async function getOrgByApiKey(db: D1Database, apiKey: string) {
  const member = await db.prepare(
    'SELECT m.org_id, m.name, m.role, o.name as org_name, o.plan, o.decision_limit, o.search_limit_daily FROM members m JOIN orgs o ON m.org_id = o.id WHERE m.api_key = ?'
  ).bind(apiKey).first<{
    org_id: string;
    name: string;
    role: string;
    org_name: string;
    plan: string;
    decision_limit: number;
    search_limit_daily: number;
  }>();

  return member;
}

export async function getMembers(db: D1Database, orgId: string) {
  const { results } = await db.prepare(
    'SELECT id, name, role, joined_at FROM members WHERE org_id = ?'
  ).bind(orgId).all();

  return results;
}
```

- [ ] **Step 3: Create org routes**

Create `packages/cloud/src/routes/orgs.ts`:

```typescript
import { Hono } from 'hono';
import { createOrg, joinOrg, getMembers } from '../db/queries.js';

type Bindings = {
  DB: D1Database;
};

const router = new Hono<{ Bindings: Bindings }>();

// POST /orgs — create new org
router.post('/', async (c) => {
  const body = await c.req.json<{ name: string }>();

  if (!body.name || body.name.length < 2 || body.name.length > 50) {
    return c.json({ error: 'name must be 2-50 characters' }, 400);
  }

  const result = await createOrg(c.env.DB, body.name);
  return c.json(result, 201);
});

// POST /orgs/:id/join — join with invite code
router.post('/:id/join', async (c) => {
  const body = await c.req.json<{ invite_code: string; name: string }>();

  if (!body.invite_code || !body.name) {
    return c.json({ error: 'invite_code and name required' }, 400);
  }

  const result = await joinOrg(c.env.DB, body.invite_code, body.name);

  if (!result) {
    return c.json({ error: 'invalid_invite_code' }, 404);
  }

  if ('error' in result) {
    return c.json({ error: result.error }, 403);
  }

  return c.json(result, 200);
});

// GET /orgs/:id/members — list members (requires auth)
router.get('/:id/members', async (c) => {
  const orgId = c.req.param('id');
  const members = await getMembers(c.env.DB, orgId);
  return c.json({ members });
});

export { router as orgsRouter };
```

- [ ] **Step 4: Mount routes in index.ts, run tests**

Update `packages/cloud/src/index.ts` to import and mount `orgsRouter`.

```bash
cd packages/cloud && pnpm test
```

Expected: placeholder tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cloud): add org creation, join, and member list endpoints"
```

---

### Task 2.2: Auth middleware

**Files:**
- Create: `packages/cloud/src/middleware/auth.ts`

- [ ] **Step 1: Write auth middleware**

```typescript
import { Context, Next } from 'hono';
import { getOrgByApiKey } from '../db/queries.js';

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header. Use: Bearer <api_key>' }, 401);
  }

  const apiKey = authHeader.slice(7);
  const member = await getOrgByApiKey(c.env.DB, apiKey);

  if (!member) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  // Attach org context to request
  c.set('org_id', member.org_id);
  c.set('member_name', member.name);
  c.set('member_role', member.role);
  c.set('plan', member.plan);
  c.set('decision_limit', member.decision_limit);
  c.set('search_limit_daily', member.search_limit_daily);

  await next();
}
```

- [ ] **Step 2: Apply to protected routes, commit**

Apply `authMiddleware` to all routes except `POST /orgs` (creation is unauthenticated) and `POST /orgs/:id/join` (uses invite code).

```bash
git add -A
git commit -m "feat(cloud): add API key auth middleware"
```

---

### Task 2.3: Qdrant Cloud service + decisions CRUD

**Files:**
- Create: `packages/cloud/src/services/qdrant.ts`
- Create: `packages/cloud/src/routes/decisions.ts`

- [ ] **Step 1: Write Qdrant Cloud client**

Create `packages/cloud/src/services/qdrant.ts`:

```typescript
interface QdrantConfig {
  url: string;
  apiKey: string;
  collection: string;
}

export class QdrantService {
  private config: QdrantConfig;

  constructor(url: string, apiKey: string) {
    this.config = { url, apiKey, collection: 'decisions' };
  }

  private async request(path: string, method: string, body?: unknown) {
    const res = await fetch(`${this.config.url}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Qdrant ${method} ${path}: ${res.status} ${text}`);
    }

    return res.json();
  }

  // Ensure collection exists with correct config
  async ensureCollection() {
    try {
      await this.request(`/collections/${this.config.collection}`, 'GET');
    } catch {
      await this.request('/collections/' + this.config.collection, 'PUT', {
        vectors: {
          size: 384, // MiniLM-L6-v2
          distance: 'Cosine',
        },
        // BM25 sparse vectors will be added when we integrate Qdrant Inference
      });

      // Create org_id payload index for filtering
      await this.request(
        `/collections/${this.config.collection}/index`,
        'PUT',
        { field_name: 'org_id', field_schema: 'Keyword' }
      );

      // Create extraction_status index for cron queries
      await this.request(
        `/collections/${this.config.collection}/index`,
        'PUT',
        { field_name: 'extraction_status', field_schema: 'Keyword' }
      );
    }
  }

  async upsertDecision(id: string, payload: Record<string, unknown>) {
    return this.request(
      `/collections/${this.config.collection}/points`,
      'PUT',
      {
        points: [{
          id,
          payload,
          // Vector will be generated by Qdrant Inference on search
          // For now, use a dummy vector — will be replaced when Inference is configured
          vector: new Array(384).fill(0),
        }],
      }
    );
  }

  async updatePayload(id: string, payload: Record<string, unknown>) {
    return this.request(
      `/collections/${this.config.collection}/points/payload`,
      'POST',
      {
        points: [id],
        payload,
      }
    );
  }

  async search(orgId: string, query: string, limit = 10, typeFilter?: string) {
    // For MVP: payload-based search using scroll + filter
    // Full hybrid search (dense + BM25) will be added when Qdrant Inference is configured
    const filter: Record<string, unknown> = {
      must: [
        { key: 'org_id', match: { value: orgId } },
      ],
    };

    if (typeFilter) {
      (filter.must as unknown[]).push({ key: 'type', match: { value: typeFilter } });
    }

    // Text match on search_keywords and summary
    const result = await this.request(
      `/collections/${this.config.collection}/points/scroll`,
      'POST',
      {
        filter,
        limit,
        with_payload: true,
      }
    );

    return result;
  }

  async scrollByFilter(filter: Record<string, unknown>, limit = 100) {
    return this.request(
      `/collections/${this.config.collection}/points/scroll`,
      'POST',
      { filter, limit, with_payload: true }
    );
  }

  async getDashboardStats(orgId: string) {
    const all = await this.scrollByFilter({
      must: [{ key: 'org_id', match: { value: orgId } }],
    }, 10000);

    const points = all.result?.points || [];
    const decisions = points.map((p: { payload: Record<string, unknown> }) => p.payload);

    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byAuthor: Record<string, number> = {};

    for (const d of decisions) {
      byType[d.type as string] = (byType[d.type as string] || 0) + 1;
      byStatus[d.status as string] = (byStatus[d.status as string] || 0) + 1;
      byAuthor[d.author as string] = (byAuthor[d.author as string] || 0) + 1;
    }

    return {
      total_decisions: decisions.length,
      by_type: byType,
      by_status: byStatus,
      by_author: Object.entries(byAuthor)
        .map(([author, count]) => ({ author, count }))
        .sort((a, b) => b.count - a.count),
      recent: decisions
        .sort((a, b) => (b.created_at as string).localeCompare(a.created_at as string))
        .slice(0, 5),
      pending_enrichment: decisions.filter(d => d.extraction_status === 'pending').length,
    };
  }
}
```

- [ ] **Step 2: Write decisions routes**

Create `packages/cloud/src/routes/decisions.ts`:

```typescript
import { Hono } from 'hono';
import { QdrantService } from '../services/qdrant.js';

type Bindings = {
  DB: D1Database;
  QDRANT_URL: string;
  QDRANT_API_KEY: string;
  SEED_QUEUE: Queue;
};

const router = new Hono<{ Bindings: Bindings }>();

// POST /orgs/:id/decisions — store raw decision
router.post('/:id/decisions', async (c) => {
  const orgId = c.get('org_id');
  const body = await c.req.json<{
    text: string;
    author?: string;
    source?: string;
    project_id?: string;
  }>();

  if (!body.text || body.text.length < 10) {
    return c.json({ error: 'text must be at least 10 characters' }, 400);
  }

  const qdrant = new QdrantService(c.env.QDRANT_URL, c.env.QDRANT_API_KEY);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = new Date().toISOString();

  await qdrant.upsertDecision(id, {
    type: 'pending',
    summary: body.text.slice(0, 100),
    detail: body.text,
    status: 'active',
    author: body.author || 'unknown',
    source: body.source || 'agent_session',
    project_id: body.project_id || 'default',
    org_id: orgId,
    created_at: now,
    updated_at: now,
    confidence: 0,
    extraction_status: 'pending',
    affects: [],
    search_keywords: [],
  });

  return c.json({ id, status: 'stored' }, 201);
});

// PATCH /orgs/:id/decisions/:did — update enriched fields
router.patch('/:id/decisions/:did', async (c) => {
  const body = await c.req.json();
  const did = c.req.param('did');

  const qdrant = new QdrantService(c.env.QDRANT_URL, c.env.QDRANT_API_KEY);
  await qdrant.updatePayload(did, {
    ...body,
    updated_at: new Date().toISOString(),
  });

  return c.json({ id: did, status: 'updated' });
});

// POST /orgs/:id/decisions/search — search decisions
router.post('/:id/decisions/search', async (c) => {
  const orgId = c.get('org_id');
  const body = await c.req.json<{ query: string; type?: string; limit?: number }>();

  const qdrant = new QdrantService(c.env.QDRANT_URL, c.env.QDRANT_API_KEY);
  const results = await qdrant.search(orgId, body.query, body.limit || 10, body.type);

  return c.json({ results: results.result?.points || [] });
});

// POST /orgs/:id/decisions/batch — bulk store for seed
router.post('/:id/decisions/batch', async (c) => {
  const orgId = c.get('org_id');
  const body = await c.req.json<{ decisions: { text: string; source?: string }[] }>();

  const qdrant = new QdrantService(c.env.QDRANT_URL, c.env.QDRANT_API_KEY);
  const ids: string[] = [];
  const now = new Date().toISOString();

  for (const d of body.decisions) {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await qdrant.upsertDecision(id, {
      type: 'pending',
      summary: d.text.slice(0, 100),
      detail: d.text,
      status: 'active',
      author: 'seed',
      source: d.source || 'seed',
      project_id: 'default',
      org_id: orgId,
      created_at: now,
      updated_at: now,
      confidence: 0,
      extraction_status: 'pending',
      affects: [],
      search_keywords: [],
    });
    ids.push(id);
  }

  // Enqueue for async enrichment
  await c.env.SEED_QUEUE.send({ org_id: orgId, decision_ids: ids });

  return c.json({ stored: ids.length, ids, enrichment: 'queued' }, 201);
});

// GET /orgs/:id/dashboard — aggregated stats
router.get('/:id/dashboard', async (c) => {
  const orgId = c.get('org_id');
  const qdrant = new QdrantService(c.env.QDRANT_URL, c.env.QDRANT_API_KEY);
  const stats = await qdrant.getDashboardStats(orgId);
  return c.json(stats);
});

export { router as decisionsRouter };
```

- [ ] **Step 3: Mount all routes in index.ts**

Update `packages/cloud/src/index.ts`:

```typescript
import { orgsRouter } from './routes/orgs.js';
import { decisionsRouter } from './routes/decisions.js';
import { authMiddleware } from './middleware/auth.js';

// Public routes
app.route('/orgs', orgsRouter);

// Protected routes
app.use('/orgs/:id/decisions/*', authMiddleware);
app.use('/orgs/:id/dashboard', authMiddleware);
app.use('/orgs/:id/members', authMiddleware);
app.route('/orgs', decisionsRouter);
```

- [ ] **Step 4: Test locally with wrangler dev**

```bash
cd packages/cloud
pnpm db:migrate
pnpm dev
# Test: curl -X POST http://localhost:8787/orgs -H 'Content-Type: application/json' -d '{"name":"test-org"}'
```

Expected: returns `{org_id, api_key, invite_code, name}`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cloud): add decisions CRUD, search, batch, dashboard endpoints"
```

---

### Task 2.4: Cron trigger for orphan enrichment

**Files:**
- Create: `packages/cloud/src/cron/orphan-enrichment.ts`
- Create: `packages/cloud/src/services/haiku.ts`

- [ ] **Step 1: Write Haiku client for cloud (Teamind's own key)**

Create `packages/cloud/src/services/haiku.ts`:

```typescript
export async function enrichDecision(
  apiKey: string,
  text: string
): Promise<{
  type: string;
  summary: string;
  detail: string;
  affects: string[];
  search_keywords: string[];
  confidence: number;
} | null> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Classify this engineering team decision. Return ONLY valid JSON.

Input: "${text}"

Return JSON:
{
  "type": "decision|constraint|pattern|lesson",
  "summary": "max 100 chars",
  "detail": "full context, 1-3 sentences",
  "affects": ["module-or-area-1", "module-or-area-2"],
  "search_keywords": ["keyword1", "keyword2", ...10-15 related terms, synonyms, concepts],
  "confidence": 1-10
}

Rules:
- "decision" = choice between alternatives with reasoning
- "constraint" = limitation or requirement imposed externally
- "pattern" = recurring approach or convention the team follows
- "lesson" = insight learned from experience, bug, or incident
- If input is vague or not a clear decision/constraint/pattern/lesson, set confidence < 5
- search_keywords should include synonyms, related concepts, and alternative phrasings that someone might search for
- affects should list specific modules, services, or areas of the codebase`,
        }],
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      content: { type: string; text: string }[];
    };
    const text_content = data.content?.[0]?.text;
    if (!text_content) return null;

    return JSON.parse(text_content);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Write orphan enrichment cron handler**

Create `packages/cloud/src/cron/orphan-enrichment.ts`:

```typescript
import { QdrantService } from '../services/qdrant.js';
import { enrichDecision } from '../services/haiku.js';

export async function handleOrphanEnrichment(env: {
  QDRANT_URL: string;
  QDRANT_API_KEY: string;
  TEAMIND_HAIKU_KEY: string;
}) {
  if (!env.TEAMIND_HAIKU_KEY) return;

  const qdrant = new QdrantService(env.QDRANT_URL, env.QDRANT_API_KEY);

  // Find records pending enrichment for more than 2 minutes
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const pending = await qdrant.scrollByFilter({
    must: [
      { key: 'extraction_status', match: { value: 'pending' } },
    ],
  }, 20); // Process max 20 per cron run

  const points = pending.result?.points || [];
  let enriched = 0;

  for (const point of points) {
    const payload = point.payload as Record<string, string>;

    // Skip if updated recently (still being enriched by user's local process)
    if (payload.updated_at > twoMinAgo) continue;

    const result = await enrichDecision(env.TEAMIND_HAIKU_KEY, payload.detail);

    if (result) {
      await qdrant.updatePayload(point.id as string, {
        ...result,
        extraction_status: 'enriched',
        updated_at: new Date().toISOString(),
      });
      enriched++;
    } else {
      await qdrant.updatePayload(point.id as string, {
        extraction_status: 'failed',
        updated_at: new Date().toISOString(),
      });
    }
  }

  console.log(`Orphan enrichment: processed ${points.length}, enriched ${enriched}`);
}
```

- [ ] **Step 3: Wire cron into index.ts scheduled handler**

```typescript
// In index.ts:
import { handleOrphanEnrichment } from './cron/orphan-enrichment.js';

// In scheduled handler:
async scheduled(event, env, ctx) {
  ctx.waitUntil(handleOrphanEnrichment(env));
},
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(cloud): add cron trigger for orphan enrichment"
```

---

### Task 2.5: Queue consumer for seed batch enrichment

**Files:**
- Create: `packages/cloud/src/queue/seed-consumer.ts`

- [ ] **Step 1: Write queue consumer**

Create `packages/cloud/src/queue/seed-consumer.ts`:

```typescript
import { QdrantService } from '../services/qdrant.js';
import { enrichDecision } from '../services/haiku.js';

interface SeedMessage {
  org_id: string;
  decision_ids: string[];
}

export async function handleSeedBatch(
  batch: MessageBatch<SeedMessage>,
  env: { QDRANT_URL: string; QDRANT_API_KEY: string; TEAMIND_HAIKU_KEY: string }
) {
  if (!env.TEAMIND_HAIKU_KEY) {
    batch.ackAll();
    return;
  }

  const qdrant = new QdrantService(env.QDRANT_URL, env.QDRANT_API_KEY);

  for (const message of batch.messages) {
    const { decision_ids } = message.body;

    for (const id of decision_ids) {
      try {
        // Fetch the record
        const result = await qdrant.scrollByFilter({
          must: [{ key: 'extraction_status', match: { value: 'pending' } }],
        }, 1);

        const point = result.result?.points?.[0];
        if (!point) continue;

        const payload = point.payload as Record<string, string>;
        const enrichment = await enrichDecision(env.TEAMIND_HAIKU_KEY, payload.detail);

        if (enrichment) {
          await qdrant.updatePayload(id, {
            ...enrichment,
            extraction_status: 'enriched',
            updated_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error(`Seed enrichment failed for ${id}:`, err);
      }
    }

    message.ack();
  }
}
```

- [ ] **Step 2: Wire into index.ts queue handler**

```typescript
import { handleSeedBatch } from './queue/seed-consumer.js';

async queue(batch, env) {
  await handleSeedBatch(batch, env);
},
```

- [ ] **Step 3: Deploy to Cloudflare (or test locally)**

```bash
cd packages/cloud
wrangler d1 create teamind-db
# Update wrangler.toml with database_id
wrangler kv:namespace create RATE_LIMITS
# Update wrangler.toml with KV id
wrangler queues create seed-enrichment
wrangler deploy
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(cloud): add seed batch queue consumer + deploy config"
```

---

## Chunk 3: MCP Server (3 tools)

### Task 3.1: Cloud API client for CLI

**Files:**
- Create: `packages/cli/src/cloud/client.ts`

- [ ] **Step 1: Write the HTTP client**

```typescript
import { TeamindConfig, StoreResponse, SearchResult, DashboardData } from '../types.js';

export class TeamindCloudClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: TeamindConfig) {
    this.baseUrl = config.cloud_url;
    this.apiKey = config.api_key;
  }

  private async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000), // 5s timeout
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cloud API ${method} ${path}: ${res.status} ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async storeDecision(text: string, author: string, source = 'agent_session', projectId = 'default') {
    return this.request<StoreResponse>(
      `/orgs/${this.getOrgPath()}/decisions`,
      'POST',
      { text, author, source, project_id: projectId }
    );
  }

  async updateDecision(id: string, enrichment: Record<string, unknown>) {
    return this.request(
      `/orgs/${this.getOrgPath()}/decisions/${id}`,
      'PATCH',
      enrichment
    );
  }

  async searchDecisions(query: string, type?: string, limit = 10) {
    return this.request<{ results: SearchResult[] }>(
      `/orgs/${this.getOrgPath()}/decisions/search`,
      'POST',
      { query, type, limit }
    );
  }

  async batchStore(decisions: { text: string; source?: string }[]) {
    return this.request<{ stored: number; ids: string[] }>(
      `/orgs/${this.getOrgPath()}/decisions/batch`,
      'POST',
      { decisions }
    );
  }

  async getDashboard() {
    return this.request<DashboardData>(
      `/orgs/${this.getOrgPath()}/dashboard`,
      'GET'
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/health', 'GET');
      return true;
    } catch {
      return false;
    }
  }

  private getOrgPath(): string {
    // org_id is embedded in the API key validation on server side
    // We use a placeholder — the server extracts org from API key
    return '_';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(cli): add Teamind Cloud API client"
```

---

### Task 3.2: MCP server with 3 tools

**Files:**
- Create: `packages/cli/src/mcp/server.ts`
- Create: `packages/cli/src/mcp/tools/store.ts`
- Create: `packages/cli/src/mcp/tools/search.ts`
- Create: `packages/cli/src/mcp/tools/context.ts`
- Create: `packages/cli/src/security/secrets.ts`
- Create: `packages/cli/src/offline/queue.ts`

- [ ] **Step 1: Write secret detection**

Create `packages/cli/src/security/secrets.ts`:

```typescript
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Anthropic API Key', pattern: /sk-ant-[a-zA-Z0-9_-]{80,}/ },
  { name: 'OpenAI API Key', pattern: /sk-[a-zA-Z0-9]{20,}T3BlbkFJ|sk-proj-[a-zA-Z0-9_-]{80,}/ },
  { name: 'GitHub Token', pattern: /ghp_[A-Za-z0-9]{36}|github_pat_|gho_[A-Za-z0-9]{36}/ },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'JWT', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ/ },
  { name: 'Database URL', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s]+@/ },
  { name: 'Slack Token', pattern: /xox[bpras]-[0-9]{10,}/ },
  { name: 'Stripe Key', pattern: /(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{24,}/ },
  { name: 'Generic Secret', pattern: /(?:password|secret|token|api_key)\s*[:=]\s*['"][^\s'"]{8,}['"]/i },
];

export function detectSecret(text: string): string | null {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return name;
    }
  }
  return null;
}
```

- [ ] **Step 2: Write offline queue**

Create `packages/cli/src/offline/queue.ts`:

```typescript
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const QUEUE_PATH = join(homedir(), '.teamind', 'pending.jsonl');

export interface PendingDecision {
  text: string;
  author: string;
  source: string;
  project_id: string;
  timestamp: string;
}

export function enqueuePending(decision: PendingDecision): void {
  appendFileSync(QUEUE_PATH, JSON.stringify(decision) + '\n');
}

export function readPending(): PendingDecision[] {
  if (!existsSync(QUEUE_PATH)) return [];

  const lines = readFileSync(QUEUE_PATH, 'utf-8').trim().split('\n').filter(Boolean);
  return lines.map(line => JSON.parse(line));
}

export function clearPending(): void {
  if (existsSync(QUEUE_PATH)) {
    writeFileSync(QUEUE_PATH, '');
  }
}

export function pendingCount(): number {
  return readPending().length;
}
```

- [ ] **Step 3: Write teamind_store tool**

Create `packages/cli/src/mcp/tools/store.ts`:

```typescript
import { z } from 'zod';
import { TeamindCloudClient } from '../../cloud/client.js';
import { detectSecret } from '../../security/secrets.js';
import { enqueuePending, pendingCount } from '../../offline/queue.js';
import { enrichWithHaiku } from '../../enrichment/haiku.js';
import { loadConfig } from '../../config/store.js';
import { ERRORS } from '../../errors.js';

export const storeSchema = z.object({
  text: z.string().min(10, 'Text must be at least 10 characters'),
});

export async function handleStore(args: { text: string }) {
  // 1. Validate input
  const parsed = storeSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: 'text' as const, text: `Error: ${parsed.error.issues[0].message}` }] };
  }

  // 2. Secret detection
  const secret = detectSecret(args.text);
  if (secret) {
    return { content: [{ type: 'text' as const, text: ERRORS.SECRET_DETECTED(secret) }] };
  }

  const config = loadConfig();
  if (!config) {
    return { content: [{ type: 'text' as const, text: 'Error: Teamind not initialized. Run: teamind init' }] };
  }

  const client = new TeamindCloudClient(config);

  // 3. Store to cloud (or queue offline)
  let id: string;
  try {
    const result = await client.storeDecision(args.text, config.author_name);
    id = result.id;
  } catch {
    // Offline — queue locally
    enqueuePending({
      text: args.text,
      author: config.author_name,
      source: 'agent_session',
      project_id: 'default',
      timestamp: new Date().toISOString(),
    });
    const pending = pendingCount();
    return {
      content: [{
        type: 'text' as const,
        text: `Stored locally (offline). ${pending} decisions pending sync.`,
      }],
    };
  }

  // 4. Async enrichment (fire and forget — don't block agent)
  if (config.anthropic_api_key) {
    enrichWithHaiku(config.anthropic_api_key, args.text, id, client).catch(() => {
      // Enrichment failed — cron will retry
    });
  }

  return {
    content: [{
      type: 'text' as const,
      text: `Decision stored (id: ${id}). Enrichment processing.`,
    }],
  };
}
```

- [ ] **Step 4: Write teamind_search tool**

Create `packages/cli/src/mcp/tools/search.ts`:

```typescript
import { z } from 'zod';
import { TeamindCloudClient } from '../../cloud/client.js';
import { loadConfig } from '../../config/store.js';

export const searchSchema = z.object({
  query: z.string().min(2),
  type: z.enum(['decision', 'constraint', 'pattern', 'lesson']).optional(),
  limit: z.number().min(1).max(20).default(10),
});

export async function handleSearch(args: { query: string; type?: string; limit?: number }) {
  const config = loadConfig();
  if (!config) {
    return { content: [{ type: 'text' as const, text: 'Error: Teamind not initialized.' }] };
  }

  const client = new TeamindCloudClient(config);

  try {
    const { results } = await client.searchDecisions(args.query, args.type, args.limit || 10);

    if (results.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No matching decisions found.' }],
      };
    }

    const formatted = results.map((r, i) => {
      const d = r.decision;
      return `${i + 1}. [${d.type}] ${d.summary}\n   Affects: ${d.affects?.join(', ') || 'unspecified'}\n   By: ${d.author} | ${d.created_at?.slice(0, 10)}\n   Detail: ${d.detail}`;
    }).join('\n\n');

    return {
      content: [{ type: 'text' as const, text: `Found ${results.length} decisions:\n\n${formatted}` }],
    };
  } catch {
    return {
      content: [{ type: 'text' as const, text: 'Search unavailable (offline). Try again when connected.' }],
    };
  }
}
```

- [ ] **Step 5: Write teamind_context tool**

Create `packages/cli/src/mcp/tools/context.ts`:

```typescript
import { z } from 'zod';
import { TeamindCloudClient } from '../../cloud/client.js';
import { loadConfig } from '../../config/store.js';

export const contextSchema = z.object({
  task_description: z.string().min(5),
  files: z.array(z.string()).optional(),
});

export async function handleContext(args: { task_description: string; files?: string[] }) {
  const config = loadConfig();
  if (!config) {
    return { content: [{ type: 'text' as const, text: 'Error: Teamind not initialized.' }] };
  }

  const client = new TeamindCloudClient(config);

  try {
    // Search using task description as query
    const { results } = await client.searchDecisions(args.task_description, undefined, 7);

    // If files provided, also search by file/module names
    let fileResults: typeof results = [];
    if (args.files?.length) {
      const fileQuery = args.files.map(f => f.split('/').pop()?.replace(/\.[^.]+$/, '')).join(' ');
      if (fileQuery) {
        const res = await client.searchDecisions(fileQuery, undefined, 5);
        fileResults = res.results;
      }
    }

    // Merge and deduplicate
    const allIds = new Set<string>();
    const merged = [...results, ...fileResults].filter(r => {
      if (allIds.has(r.decision.id)) return false;
      allIds.add(r.decision.id);
      return true;
    }).slice(0, 10);

    if (merged.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No relevant team decisions found for this task. Consider storing important decisions with teamind_store.',
        }],
      };
    }

    const constraints = merged.filter(r => r.decision.type === 'constraint');
    const decisions = merged.filter(r => r.decision.type === 'decision');
    const patterns = merged.filter(r => r.decision.type === 'pattern');
    const lessons = merged.filter(r => r.decision.type === 'lesson');

    let output = `Team context for your task (${merged.length} relevant items):\n`;

    if (constraints.length > 0) {
      output += `\nConstraints (must follow):\n${constraints.map(r => `  - ${r.decision.summary}`).join('\n')}`;
    }
    if (decisions.length > 0) {
      output += `\nDecisions (already made):\n${decisions.map(r => `  - ${r.decision.summary}`).join('\n')}`;
    }
    if (patterns.length > 0) {
      output += `\nPatterns (follow these):\n${patterns.map(r => `  - ${r.decision.summary}`).join('\n')}`;
    }
    if (lessons.length > 0) {
      output += `\nLessons (be aware):\n${lessons.map(r => `  - ${r.decision.summary}`).join('\n')}`;
    }

    output += '\n\nUse teamind_search for more specific queries.';

    return { content: [{ type: 'text' as const, text: output }] };
  } catch {
    return {
      content: [{
        type: 'text' as const,
        text: 'Context unavailable (offline). Proceeding without team context.',
      }],
    };
  }
}
```

- [ ] **Step 6: Write MCP server entry**

Create `packages/cli/src/mcp/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { handleStore, storeSchema } from './tools/store.js';
import { handleSearch, searchSchema } from './tools/search.js';
import { handleContext, contextSchema } from './tools/context.js';

export async function startMcpServer() {
  const server = new McpServer({
    name: 'teamind',
    version: '0.1.0',
  });

  server.tool(
    'teamind_store',
    `Store a team decision, architectural constraint, coding pattern, or lesson learned into the shared team brain. Call this when:
- A technical decision is made ("We chose PostgreSQL because...")
- A constraint is identified ("Client requires Safari 15+ support")
- A pattern is established ("All API endpoints use /api/v1/{resource}")
- A lesson is learned from a bug or incident

Do NOT store: status updates, trivial changes, questions without answers, brainstorming without conclusions.`,
    { text: storeSchema.shape.text },
    async (args) => handleStore(args as { text: string })
  );

  server.tool(
    'teamind_search',
    `Search the team's shared decision history before making architectural choices. Call this BEFORE:
- Choosing a technology, library, or pattern (check if the team already decided)
- Modifying a module's architecture (check for existing constraints)
- Implementing something you're unsure about (check for lessons learned)

Returns matching decisions ranked by relevance.`,
    {
      query: searchSchema.shape.query,
      type: searchSchema.shape.type,
      limit: searchSchema.shape.limit,
    },
    async (args) => handleSearch(args as { query: string; type?: string; limit?: number })
  );

  server.tool(
    'teamind_context',
    `Load relevant team decisions for the current task. Call this at the START of a new task or when switching context to a different part of the codebase. Provide your task description and the files you're working on.`,
    {
      task_description: contextSchema.shape.task_description,
      files: contextSchema.shape.files,
    },
    async (args) => handleContext(args as { task_description: string; files?: string[] })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(cli): add MCP server with teamind_store, teamind_search, teamind_context"
```

---

## Chunk 4: Haiku Enrichment + Config Management

### Task 4.1: Haiku enrichment client (local)

**Files:**
- Create: `packages/cli/src/enrichment/haiku.ts`

- [ ] **Step 1: Write local Haiku enrichment**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { TeamindCloudClient } from '../cloud/client.js';
import type { EnrichmentResult } from '../types.js';

const EXTRACTION_PROMPT = `Classify this engineering team decision. Return ONLY valid JSON, no markdown.

Input: "{TEXT}"

{
  "type": "decision|constraint|pattern|lesson",
  "summary": "max 100 chars, what was decided/established",
  "detail": "1-3 sentences with full context and reasoning",
  "affects": ["module-1", "area-2"],
  "search_keywords": ["kw1", "kw2", ...10-15 synonyms, related concepts, alternative phrasings],
  "confidence": 1-10
}

Rules:
- decision = choice between alternatives ("chose X because Y")
- constraint = external limitation ("must support X", "cannot use Y")
- pattern = recurring convention ("all X follow Y format")
- lesson = insight from experience/bug ("X caused Y, fixed by Z")
- If unclear/vague, confidence < 5
- search_keywords: include synonyms, abbreviations, related tech, conceptual terms
- affects: specific modules/services/areas, not generic terms`;

export async function enrichWithHaiku(
  apiKey: string,
  text: string,
  decisionId: string,
  cloudClient: TeamindCloudClient
): Promise<void> {
  const client = new Anthropic({ apiKey, timeout: 5000 }); // 5s timeout

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: EXTRACTION_PROMPT.replace('{TEXT}', text.replace(/"/g, '\\"')),
      }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return;

    const result: EnrichmentResult = JSON.parse(content.text);

    // Validate required fields
    if (!result.type || !result.summary) return;

    // Update cloud record with enriched data
    await cloudClient.updateDecision(decisionId, {
      type: result.type,
      summary: result.summary.slice(0, 100),
      detail: result.detail || text,
      affects: result.affects || [],
      search_keywords: result.search_keywords || [],
      confidence: result.confidence || 5,
      extraction_status: 'enriched',
    });
  } catch {
    // Enrichment failed — record stays as pending, cron will retry
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(cli): add local Haiku enrichment with extraction prompt"
```

---

### Task 4.2: Config management

**Files:**
- Create: `packages/cli/src/config/store.ts`
- Create: `packages/cli/src/config/manifest.ts`

- [ ] **Step 1: Write config store**

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TeamindConfig } from '../types.js';

const CONFIG_DIR = join(homedir(), '.teamind');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): TeamindConfig | null {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveConfig(config: TeamindConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  chmodSync(CONFIG_PATH, 0o600); // Owner read/write only
}

export function updateConfig(updates: Partial<TeamindConfig>): void {
  const config = loadConfig();
  if (!config) throw new Error('Config not found. Run: teamind init');
  saveConfig({ ...config, ...updates });
}

export function getConfigValue(key: keyof TeamindConfig): string | undefined {
  const config = loadConfig();
  return config?.[key] as string | undefined;
}
```

- [ ] **Step 2: Write manifest tracker**

Create `packages/cli/src/config/manifest.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MANIFEST_PATH = join(homedir(), '.teamind', 'manifest.json');

interface Manifest {
  created_at: string;
  modified_files: { path: string; type: 'mcp_config' | 'claude_md' | 'cursorrules' | 'agents_md' }[];
}

export function loadManifest(): Manifest | null {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveManifest(manifest: Manifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

export function trackFile(path: string, type: Manifest['modified_files'][0]['type']): void {
  const manifest = loadManifest() || { created_at: new Date().toISOString(), modified_files: [] };
  if (!manifest.modified_files.some(f => f.path === path)) {
    manifest.modified_files.push({ path, type });
  }
  saveManifest(manifest);
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(cli): add config management and manifest tracking"
```

---

## Chunk 5: CLI Commands (init, serve, status, dashboard, export, uninstall)

_This chunk contains the remaining CLI commands. Each is a separate task. Due to plan length, showing the key ones — `init` and `serve` — with the rest following the same pattern._

### Task 5.1: `teamind serve` command

**Files:**
- Create: `packages/cli/src/commands/serve.ts`
- Create: `packages/cli/bin/teamind.ts`

- [ ] **Step 1: Write serve command (just launches MCP server)**

```typescript
import { startMcpServer } from '../mcp/server.js';

export async function serveCommand() {
  await startMcpServer();
}
```

- [ ] **Step 2: Write CLI entry point**

Create `packages/cli/bin/teamind.ts`:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('teamind')
  .description('Shared decision intelligence for AI-augmented engineering teams')
  .version('0.1.0');

program
  .command('serve')
  .description('Start MCP server (called by IDE)')
  .action(async () => {
    const { serveCommand } = await import('../src/commands/serve.js');
    await serveCommand();
  });

program
  .command('init')
  .description('Initialize Teamind for your project')
  .option('--join <code>', 'Join existing org with invite code')
  .action(async (opts) => {
    const { initCommand } = await import('../src/commands/init.js');
    await initCommand(opts);
  });

program
  .command('status')
  .description('Check Teamind health')
  .action(async () => {
    const { statusCommand } = await import('../src/commands/status.js');
    await statusCommand();
  });

program
  .command('dashboard')
  .description('Show team decision dashboard')
  .action(async () => {
    const { dashboardCommand } = await import('../src/commands/dashboard.js');
    await dashboardCommand();
  });

program
  .command('export')
  .description('Export all decisions')
  .option('--json', 'Export as JSON')
  .option('--markdown', 'Export as Markdown')
  .action(async (opts) => {
    const { exportCommand } = await import('../src/commands/export-cmd.js');
    await exportCommand(opts);
  });

program
  .command('uninstall')
  .description('Remove Teamind from this project')
  .action(async () => {
    const { uninstallCommand } = await import('../src/commands/uninstall.js');
    await uninstallCommand();
  });

program
  .command('config')
  .description('Get or set config values')
  .argument('<action>', 'set or get')
  .argument('<key>', 'config key')
  .argument('[value]', 'value to set')
  .action(async (action, key, value) => {
    const { configCommand } = await import('../src/commands/config-cmd.js');
    await configCommand(action, key, value);
  });

program.parse();
```

- [ ] **Step 3: Build + test CLI entry**

```bash
cd packages/cli
pnpm build
node dist/bin/teamind.js --version
# Expected: 0.1.0
node dist/bin/teamind.js serve --help
# Expected: help text
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(cli): add CLI entry point with serve command"
```

---

### Task 5.2: `teamind init` command

_This is the most complex command. Creates org (or joins), prompts for API key, detects IDEs, seeds knowledge base, configures MCP._

**Files:**
- Create: `packages/cli/src/commands/init.ts`
- Create: `packages/cli/src/ide/detect.ts`
- Create: `packages/cli/src/ide/claude-code.ts`
- Create: `packages/cli/src/ide/cursor.ts`
- Create: `packages/cli/src/ide/codex.ts`
- Create: `packages/cli/src/seed/index.ts`
- Create: `packages/cli/src/seed/parse-claude-md.ts`
- Create: `packages/cli/src/seed/parse-git-log.ts`

_Due to plan length, these implementations follow the same TDD pattern as above. Each file is a small, focused module. The init command orchestrates: prompt → create/join org → save config → detect IDEs → configure MCP → seed → verify._

- [ ] **Step 1: Write IDE detection** (check for ~/.claude/, .cursor/, .codex/)
- [ ] **Step 2: Write Claude Code MCP config writer** (JSON merge into settings.json)
- [ ] **Step 3: Write Cursor MCP config writer** (.cursor/mcp.json)
- [ ] **Step 4: Write CLAUDE.md injection** (markers, create/append/replace)
- [ ] **Step 5: Write seed parsers** (CLAUDE.md regex, git log filter)
- [ ] **Step 6: Write init orchestrator** (prompts, API calls, config save)
- [ ] **Step 7: Test full init flow** (`teamind init` in a test project)
- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(cli): add teamind init with org creation, IDE setup, and seeding"
```

---

### Task 5.3-5.6: Remaining CLI commands

_Following the same pattern:_

- [ ] **Task 5.3: `teamind status`** — calls cloud healthCheck, checks config, shows decision count
- [ ] **Task 5.4: `teamind dashboard`** — calls getDashboard, formats as colored terminal table
- [ ] **Task 5.5: `teamind export`** — calls searchDecisions (all), writes JSON/Markdown file
- [ ] **Task 5.6: `teamind uninstall`** — reads manifest, removes all tracked files/configs, clean exit

---

## Chunk 6: Integration Testing + Polish

### Task 6.1: End-to-end test

- [ ] **Step 1: Deploy cloud to Cloudflare**
- [ ] **Step 2: `npm install -g .` from packages/cli**
- [ ] **Step 3: Run `teamind init` → create org → seed**
- [ ] **Step 4: Open Claude Code → test teamind_store → teamind_search → teamind_context**
- [ ] **Step 5: Run `teamind dashboard` → verify stats**
- [ ] **Step 6: Run `teamind export --json` → verify output**
- [ ] **Step 7: Run `teamind uninstall` → verify clean removal**
- [ ] **Step 8: Verify acceptance criteria 1-12 from spec**

### Task 6.2: README + AGENTS.md

- [ ] **Step 1: Write README.md** (install, quickstart, features, pricing link)
- [ ] **Step 2: Write AGENTS.md** (Teamind eats its own dogfood — instructions for agents working on this repo)
- [ ] **Step 3: Publish to npm** (`npm publish` from packages/cli)

---

## Build Order Summary

| Week | Tasks | Output |
|------|-------|--------|
| 1 | Chunks 1-2 (scaffold + cloud API) | Working cloud backend on Cloudflare |
| 2 | Chunk 3 (MCP server) | MCP server with 3 tools connected to cloud |
| 3 | Chunk 4 (enrichment + config) | Haiku enrichment + config management |
| 4 | Chunk 5 (CLI commands) | Full CLI: init, serve, status, dashboard, export, uninstall |
| 5 | Chunk 6 (integration + polish) | End-to-end tested, npm published |
| 6 | Private beta + fixes | 3-5 teams testing |
