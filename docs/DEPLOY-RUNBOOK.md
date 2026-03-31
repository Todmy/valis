# VALIS Deploy Runbook

Step-by-step guide for deploying VALIS from scratch. Covers hosted mode (Supabase + Qdrant Cloud + Vercel). For self-hosted/community mode, see `community/README.md`.

**Domain**: `valis.krukit.co`
**Supabase project ref (example)**: `rmawxpdaudinbansjfpd` (replace with yours)

---

## 1. Prerequisites

### Required software

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | `brew install node` or [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `corepack enable && corepack prepare pnpm@latest --activate` |
| Supabase CLI | latest | `brew install supabase/tap/supabase` |
| Vercel CLI | latest | `npm i -g vercel` |

### Required accounts

| Service | Purpose | Free tier |
|---------|---------|-----------|
| [Supabase](https://supabase.com) | Postgres database, auth, Realtime | 2 projects, 500 MB |
| [Qdrant Cloud](https://cloud.qdrant.io) | Vector + BM25 search | 1 GB, 1 cluster |
| [Vercel](https://vercel.com) | Next.js API hosting + dashboard | Hobby plan |
| [Stripe](https://stripe.com) | Billing (optional, defer to post-dogfooding) | Test mode free |

### Clone and install

```bash
git clone https://github.com/todmy/teamind.git
cd teamind
pnpm install
```

---

## 2. Supabase Setup

### 2.1 Create project

1. Go to [app.supabase.com](https://app.supabase.com) and create a new project
2. Pick a region close to your users (e.g., `eu-central-1` for Europe)
3. Set a strong database password and save it somewhere safe
4. Wait for the project to finish provisioning (~2 minutes)

### 2.2 Link local repo to Supabase

```bash
# From the repo root (where supabase/ directory lives)
supabase link --project-ref rmawxpdaudinbansjfpd
```

You'll be prompted for the database password you set in step 2.1.

### 2.3 Push all migrations

```bash
supabase db push
```

This applies 7 migrations in order:

| Migration | What it does |
|-----------|-------------|
| `001_init.sql` | Core tables: `orgs`, `members`, `decisions`, `rate_limits` |
| `002_retention.sql` | Decision lifecycle, audit trail, contradiction detection |
| `003_search_growth.sql` | Search metadata, billing tables, knowledge compression |
| `004_multi_project.sql` | `projects` + `project_members` tables, project-scoped isolation |
| `005_registration_api.sql` | Zero-config registration support |
| `006_org_created_audit.sql` | Audit entry for org creation |
| `007_increment_rate_limit.sql` | Rate limit increment function |

Verify with:

```bash
supabase db diff
```

Should return no output (no drift).

### 2.4 Enable Realtime

Realtime is required for cross-session push notifications.

1. Go to **Supabase Dashboard** -> **Database** -> **Publications**
2. Find `supabase_realtime`
3. Add these tables to the publication:
   - `decisions`
   - `audit_entries`

Or via SQL:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE decisions;
ALTER PUBLICATION supabase_realtime ADD TABLE audit_entries;
```

### 2.5 Collect credentials

Go to **Supabase Dashboard** -> **Settings** -> **API** and note:

| Value | Where | Example |
|-------|-------|---------|
| Project URL | Settings -> API -> URL | `https://rmawxpdaudinbansjfpd.supabase.co` |
| Anon key | Settings -> API -> Project API keys -> `anon public` | `eyJhbGci...` |
| Service role key | Settings -> API -> Project API keys -> `service_role` (secret) | `eyJhbGci...` |

**Do not commit these keys.** The service role key bypasses RLS.

---

## 3. Qdrant Cloud Setup

### 3.1 Create cluster

1. Go to [cloud.qdrant.io](https://cloud.qdrant.io) and sign in
2. Create a new cluster:
   - **Name**: `valis` (or whatever you prefer)
   - **Cloud**: AWS
   - **Region**: `eu-central-1` (match your Supabase region for lower latency)
   - **Tier**: Free (1 GB RAM, sufficient for initial use)
3. Wait for the cluster to provision (~1 minute)

### 3.2 Collect credentials

| Value | Where |
|-------|-------|
| Cluster URL | Cluster detail page, e.g. `https://c424cb8c-...aws.cloud.qdrant.io` |
| API key | **Data Access Control** -> **API Keys** -> create one |

### 3.3 Collection creation

You do NOT need to create the `decisions` collection manually. `valis init` (step 6) creates it automatically with:
- 384-dimensional cosine vectors (for MiniLM embeddings)
- BM25 sparse vectors
- Payload indexes on `org_id`, `type`, `project_id`

---

## 4. Vercel Setup

### 4.1 Login and link

```bash
vercel login
```

From the repo root:

```bash
vercel link
```

This creates `.vercel/project.json`. The project is already linked as `valis` (project ID: `prj_6FbRM78WBxNEDG62t0UwI7rdT7xs`).

### 4.2 Configure Root Directory

The web package lives in `packages/web`, not the repo root.

1. Go to **Vercel Dashboard** -> **valis** -> **Settings** -> **General**
2. Set **Root Directory** to `packages/web`
3. Framework should auto-detect as **Next.js**

Or during `vercel link`, select `packages/web` as the root directory when prompted.

### 4.3 Set environment variables

Go to **Vercel Dashboard** -> **valis** -> **Settings** -> **Environment Variables**.

Add all 7 required variables for Production, Preview, and Development scopes:

| Variable | Value source | Scope |
|----------|-------------|-------|
| `SUPABASE_URL` | Supabase Dashboard -> Settings -> API -> URL | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard -> Settings -> API -> `service_role` key | Production, Preview, Development |
| `JWT_SECRET` | Generate with `openssl rand -hex 32` | Production, Preview, Development |
| `QDRANT_URL` | Qdrant Cloud -> Cluster URL | Production, Preview, Development |
| `QDRANT_API_KEY` | Qdrant Cloud -> API Keys | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_URL` | Same value as `SUPABASE_URL` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard -> Settings -> API -> `anon` key | Production, Preview, Development |

**Email notifications (required for member invites):**

| Variable | Value source |
|----------|-------------|
| `RESEND_API_KEY` | [resend.com](https://resend.com) -> API Keys -> Create key. Domain must be verified for `valis.krukit.co` |

**Optional (enrichment):**

| Variable | Value source | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) -> API Keys | Required for `/api/enrich` |
| `ENRICHMENT_DAILY_BUDGET_CENTS` | Your call | `100` ($1.00/day per org) |

**Optional (billing, defer to post-dogfooding):**

| Variable | Value source |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe Dashboard -> Developers -> API Keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard -> Webhooks -> Signing secret |
| `STRIPE_PRICE_TEAM_MONTHLY` | Stripe -> Products -> Team -> Monthly price ID |
| `STRIPE_PRICE_TEAM_ANNUAL` | Stripe -> Products -> Team -> Annual price ID |
| `STRIPE_PRICE_BUSINESS_MONTHLY` | Stripe -> Products -> Business -> Monthly price ID |
| `STRIPE_PRICE_BUSINESS_ANNUAL` | Stripe -> Products -> Business -> Annual price ID |

### 4.4 Deploy

```bash
cd packages/web
vercel deploy --prod
```

Or push to `main` if Git integration is connected (auto-deploys).

The build uses these settings from `vercel.json`:

```json
{
  "framework": "nextjs",
  "buildCommand": "next build",
  "outputDirectory": ".next",
  "installCommand": "pnpm install"
}
```

### 4.5 Verify deployment

After deploy completes, Vercel prints the production URL. Open it in a browser. You should see the VALIS dashboard (or a landing page if one exists).

---

## 5. DNS

### 5.1 Add custom domain in Vercel

1. Go to **Vercel Dashboard** -> **valis** -> **Settings** -> **Domains**
2. Add `valis.krukit.co`

### 5.2 Configure DNS

Add a CNAME record at your DNS provider (where `krukit.co` is managed):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | `valis` | `cname.vercel-dns.com` | 300 |

Wait for DNS propagation (usually under 5 minutes, can take up to 48 hours).

### 5.3 Verify

```bash
dig valis.krukit.co CNAME +short
# Expected: cname.vercel-dns.com.
```

Vercel automatically provisions an SSL certificate once DNS resolves.

---

## 6. CLI Setup

### 6.1 Build and link

```bash
cd packages/cli
pnpm build
npm link
```

This makes the `valis` command available globally.

### 6.2 Initialize (hosted mode)

```bash
valis init
```

Interactive prompts:
1. **Mode**: Choose `Hosted`
2. **Org name**: Your organization name
3. **Project name**: Your project name
4. **Your name**: Author name for decisions

This calls the `/api/register` endpoint on `valis.krukit.co`, which atomically creates:
- Organization with API key and invite code
- Default project
- Your member record with a member API key

Config is saved to `~/.valis/config.json`.

### 6.3 Verify connectivity

```bash
valis status
```

Expected output:
- Supabase: connected
- Qdrant: connected
- Org/project info displayed

### 6.4 Test the full flow

```bash
# Start the MCP server (for Claude Code / Cursor integration)
valis serve &

# Store a test decision manually
# (or use Claude Code with valis MCP server)

# Check search works
valis search "test"

# Open dashboard in browser
valis dashboard
```

---

## 7. Post-Deploy Verification

Run through this checklist after every fresh deployment:

### API endpoints

All 15 API routes live at `https://valis.krukit.co/api/<name>`:

| Endpoint | Method | Auth | Quick test |
|----------|--------|------|------------|
| `/api/register` | POST | None (IP rate-limited) | `valis init` in hosted mode |
| `/api/check-usage` | POST | Bearer JWT | Automatic during `valis store` |
| `/api/search` | POST | Bearer JWT | `valis search "anything"` |
| `/api/enrich` | POST | Bearer JWT | `valis enrich` |
| `/api/create-org` | POST | Bearer JWT | Admin only |
| `/api/create-project` | POST | Bearer JWT | Admin only |
| `/api/join-org` | POST | Bearer JWT | Via invite code |
| `/api/join-project` | POST | Bearer JWT | Via project invite |
| `/api/change-status` | POST | Bearer JWT | Decision lifecycle |
| `/api/exchange-token` | POST | Bearer JWT | Token refresh |
| `/api/rotate-key` | POST | Bearer JWT | Key rotation |
| `/api/revoke-member` | POST | Bearer JWT | Admin only |
| `/api/seed` | POST | Bearer JWT | Dev/test data |
| `/api/create-checkout` | POST | Bearer JWT | Stripe (when enabled) |
| `/api/stripe-webhook` | POST | Stripe signature | Stripe (when enabled) |

### Functional checklist

- [ ] `valis init` completes without errors (hosted mode, zero-config)
- [ ] Store a decision via MCP or CLI -> appears in Postgres + Qdrant
- [ ] `valis search "<your decision text>"` returns the stored decision
- [ ] Web dashboard at `valis.krukit.co` loads and shows decisions
- [ ] `valis enrich` works (requires `ANTHROPIC_API_KEY` set in Vercel)
- [ ] Rate limits trigger correctly: exceed free tier (100 decisions), confirm block
- [ ] Invite code flow: second user joins with `valis init` -> enter invite code
- [ ] Realtime: store a decision in one session, see it push to another session
- [ ] Vercel function logs show no errors: **Vercel Dashboard** -> **Deployments** -> **Functions** tab

### Security checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is not exposed in client-side code or git
- [ ] `JWT_SECRET` is unique, not reused from another service
- [ ] No secrets in git history: `git log -p -S 'sb_secret' | head` returns nothing
- [ ] Old API keys rotated if this is a redeployment

---

## 8. Troubleshooting

### `vercel deploy` fails with secrets reference error

**Symptom**: Build error mentioning `@secret` or environment variable references.

**Fix**: The `vercel.json` was cleaned up in commit `9e9f978`. Make sure your `packages/web/vercel.json` contains no `env` block with `@`-prefixed secret references. Current correct version:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "next build",
  "outputDirectory": ".next",
  "installCommand": "pnpm install"
}
```

### `supabase db push` fails

**Symptom**: Connection error or auth failure.

**Fix**:
1. Verify you've linked: `supabase link --project-ref rmawxpdaudinbansjfpd`
2. Check your database password is correct
3. Ensure `supabase/config.toml` has no `[project]` section (it's not needed for remote push, and can conflict):

```toml
[api]
enabled = true
port = 54321
schemas = ["public"]

[db]
port = 54322

[studio]
enabled = true
port = 54323
```

### `pnpm install` fails in Vercel build

**Symptom**: Build fails at install step.

**Fix**:
1. Verify `installCommand` in `vercel.json` is `"pnpm install"`
2. Check that `packages/web/package.json` lists all dependencies correctly
3. In Vercel Dashboard -> Settings -> General, confirm Root Directory is `packages/web`

### `valis init` hangs or returns 500

**Symptom**: Registration request fails.

**Fix**:
1. Check Vercel function logs: **Dashboard** -> **Deployments** -> latest -> **Functions** tab
2. Verify all 7 env vars are set in Vercel (especially `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`)
3. Verify migrations are applied: `supabase db push` from repo root
4. Check the `/api/register` route is deployed: `curl -X POST https://valis.krukit.co/api/register -H 'Content-Type: application/json' -d '{"org_name":"test","project_name":"test","author_name":"test"}'`

### Qdrant connection errors

**Symptom**: Search fails, `valis status` shows Qdrant disconnected.

**Fix**:
1. Verify `QDRANT_URL` includes `https://` and the full cluster hostname
2. Verify `QDRANT_API_KEY` is correct and not expired
3. Check cluster status at [cloud.qdrant.io](https://cloud.qdrant.io) -- free tier clusters pause after inactivity, may need a few seconds to wake up

### Realtime not working

**Symptom**: Cross-session push doesn't fire, decisions don't appear in other sessions.

**Fix**:
1. Verify Realtime is enabled: **Supabase Dashboard** -> **Database** -> **Publications** -> `supabase_realtime` includes `decisions` and `audit_entries`
2. Check connection limits: free tier allows 200 concurrent Realtime connections

### CORS errors on dashboard

**Symptom**: Browser console shows CORS blocked requests.

**Fix**: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be set in Vercel env vars. These are client-side variables (the `NEXT_PUBLIC_` prefix exposes them to the browser).

---

## 9. Updating

### Deploy code changes

**Option A: Git push (recommended if Git integration is connected)**

```bash
git push origin main
```

Vercel auto-deploys on push to `main`.

**Option B: Manual deploy**

```bash
cd packages/web
vercel deploy --prod
```

### Apply new migrations

When new migration files are added to `supabase/migrations/`:

```bash
# From repo root
supabase db push
```

This only applies unapplied migrations. Already-applied migrations are skipped.

Verify:

```bash
supabase migration list
```

### Update CLI

After pulling new code:

```bash
cd packages/cli
pnpm build
# npm link is persistent, no need to re-link
```

Verify:

```bash
valis --version
```

### Rollback a deployment

If a Vercel deployment breaks:

1. Go to **Vercel Dashboard** -> **Deployments**
2. Find the last working deployment
3. Click **...** -> **Promote to Production**

Database migrations cannot be auto-rolled back. If a migration needs reverting, write a new migration that undoes the changes and run `supabase db push`.

---

## Appendix: Architecture Reference

```
User (CLI / MCP)
  |
  v
valis CLI (packages/cli)
  |
  +--> Supabase Postgres (decisions, orgs, members, rate_limits)
  |      via supabase-js + service_role key (community)
  |      via Vercel API routes + JWT auth (hosted)
  |
  +--> Qdrant Cloud (vector + BM25 search)
  |      via /api/search proxy (hosted)
  |      via direct connection (community)
  |
  +--> Vercel API (packages/web/src/app/api/)
         15 Next.js API routes
         JWT auth (jose)
         Server-side enrichment (Anthropic)
         Rate limiting
```

**Hosted mode**: CLI talks to Vercel API routes (`valis.krukit.co/api/*`), which talk to Supabase and Qdrant using server-side credentials. Users authenticate with per-member JWT tokens.

**Community mode**: CLI talks directly to local Postgres and Qdrant using service_role key. No Vercel needed. See `community/README.md`.
