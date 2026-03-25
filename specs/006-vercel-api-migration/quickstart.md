# Quickstart: Vercel API Migration Validation

## Prerequisites

- Teamind Phase 5 (registration API) installed and working
- `packages/web` deployed to Vercel at `https://teamind.krukit.co`
- Vercel env vars configured: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  JWT_SECRET, QDRANT_URL, QDRANT_API_KEY, STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET, ANTHROPIC_API_KEY, all STRIPE_PRICE_* vars
- CLI built with HOSTED_API_URL pointing to Vercel
- Two machines/terminals for testing join flow

## 1. Hosted Registration via Vercel (US1 + US2)

```bash
# Fresh machine — no ~/.teamind/ directory, no .teamind.json

teamind init
# Expected: "Choose your setup: 1) Hosted  2) Community"
# Select: 1

# Prompts:
#   Organization name: Migration Test Org
#   Project name (my-repo): my-repo
#   Your name: Alice

# Expected output:
#   Registering with Teamind Cloud...
#   ✓ Organization "Migration Test Org" created
#   ✓ Project "my-repo" created
#   ✓ Config saved
#   ...IDE detection, Qdrant setup, seed...

# Verify registration went through Vercel (not Supabase EF):
# Check Vercel dashboard -> Functions -> /api/register should show invocation

# Verify config:
cat ~/.teamind/config.json
# Expected: member_api_key present (tmm_...)
# Expected: supabase_url present (Supabase URL for direct DB access)
# Expected: NO reference to /functions/v1/ in any stored URL

# Verify subsequent operations route through Vercel:
teamind status
# Expected: works — exchange-token called via /api/exchange-token
```

## 2. CLI API Calls via Vercel (US2)

```bash
# After init, store a decision (triggers exchange-token + check-usage):
# Start teamind serve, then in an IDE session:
#   teamind_store("Test decision for migration validation")

# Check Vercel logs — should see:
#   POST /api/exchange-token  (JWT minting)
#   POST /api/check-usage     (usage check)

# No calls to supabase.co/functions/v1/ for hosted mode
```

## 3. Join via Invite (US1 + US2)

```bash
# Machine 2 — fresh install, no config
# Use invite code from step 1

teamind init --join XXXX-XXXX
# Prompt: Your name: Bob

# Expected output:
#   ✓ Joined project "my-repo" in org "Migration Test Org"
#   ✓ Config saved

# Verify Vercel logs show: POST /api/join-project

teamind status
# Expected: works via Vercel API routes
```

## 4. Hosted Enrichment (US3)

```bash
# Store a pending decision (via MCP or direct):
#   teamind_store({ text: "We should use Redis for caching" })

# Call enrichment (this will be a CLI command or MCP tool call):
# The CLI calls POST /api/enrich with the decision ID

# Verify in Vercel logs:
#   POST /api/enrich
#   - Authenticated via Bearer JWT
#   - Called Anthropic API
#   - Updated Postgres + Qdrant

# Verify decision is enriched:
# teamind_search("Redis caching")
# Expected: result has type, summary, affects, confidence
# Expected: enriched_by = 'llm'
```

## 5. Community Mode Unchanged (US4)

```bash
# Fresh machine
teamind init
# Select: 2 (Community)

# Prompts (same as before):
#   Supabase URL: https://my-instance.supabase.co
#   Supabase Service Role Key: eyJ...
#   Qdrant URL: https://my-cluster.qdrant.io
#   Qdrant API Key: abc123

# Expected: proceeds exactly as current Phase 5 init
# API calls go to supabaseUrl/functions/v1/ (NOT Vercel)

# Verify no Vercel calls in community mode:
# teamind status — exchange-token should hit my-instance.supabase.co
```

## 6. Supabase EFs Disabled (US5)

```bash
# In Supabase dashboard: disable all 13 Edge Functions
# (Or rename them so they 404)

# Run full hosted flow:
teamind init  # Hosted
# Expected: succeeds via Vercel (no EF dependency)

teamind status
# Expected: works

# Store + search:
#   teamind_store("Test after EF disable")
#   teamind_search("test")
# Expected: both work via Vercel API routes + direct Supabase DB

# Re-enable EFs for community users
```

## 7. API Route Contract Tests

```bash
# Test each API route matches its EF contract:

# register
curl -s -X POST https://teamind.krukit.co/api/register \
  -H "Content-Type: application/json" \
  -d '{"org_name":"curl-test","project_name":"proj","author_name":"tester"}'
# Expected: 201 with member_api_key, supabase_url, qdrant_url, org_id, etc.

# exchange-token (use member_api_key from register)
curl -s -X POST https://teamind.krukit.co/api/exchange-token \
  -H "Authorization: Bearer tmm_..." \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: 200 with token, expires_at, member_id, org_id, role, etc.

# check-usage (use JWT from exchange-token)
curl -s -X POST https://teamind.krukit.co/api/check-usage \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"org_id":"uuid","operation":"store"}'
# Expected: 200 with allowed, plan

# Repeat for all 13 routes...
```

## 8. Cold Start Performance

```bash
# After deployment, wait 10 minutes for functions to go cold

# Time a cold-start exchange-token call:
time curl -s -X POST https://teamind.krukit.co/api/exchange-token \
  -H "Authorization: Bearer tmm_..." \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: < 500ms total (including cold start)

# Time a warm call (immediately after):
time curl -s -X POST https://teamind.krukit.co/api/exchange-token \
  -H "Authorization: Bearer tmm_..." \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: < 200ms
```

## 9. Stripe Webhook URL Migration (T041)

After deploying the Vercel API routes, the Stripe dashboard webhook endpoint
must be updated from the old Supabase Edge Function URL to the new Vercel
API route URL.

**Old URL (Supabase EF — deprecated for hosted):**
```
https://rmawxpdaudinbansjfpd.supabase.co/functions/v1/stripe-webhook
```

**New URL (Vercel API route):**
```
https://teamind.krukit.co/api/stripe-webhook
```

Steps:
1. Go to https://dashboard.stripe.com/webhooks
2. Select the existing teamind webhook endpoint
3. Update the endpoint URL from the old to the new URL above
4. Verify events are received by checking Vercel function logs
5. Community/self-hosted deployments continue using the Supabase EF URL

## Validation Checklist

### US1 — Migrate Edge Functions to API Routes
- [ ] All 13 API routes deployed and responding
- [ ] register returns identical shape to EF
- [ ] join-project returns identical shape to EF
- [ ] join-org returns identical shape to EF
- [ ] create-org returns identical shape to EF
- [ ] create-project returns identical shape to EF
- [ ] exchange-token returns identical JWT to EF
- [ ] change-status returns identical shape to EF
- [ ] rotate-key returns identical shape to EF
- [ ] revoke-member returns identical shape to EF
- [ ] check-usage returns identical shape to EF
- [ ] stripe-webhook processes events identically
- [ ] create-checkout returns identical shape to EF
- [ ] seed returns identical shape to EF
- [ ] CORS headers work for cross-origin CLI calls
- [ ] No Deno references in any API route

### US2 — CLI Points to Vercel API URL
- [ ] `HOSTED_API_URL` constant defined in types.ts
- [ ] registration.ts calls /api/register (not /functions/v1/register)
- [ ] jwt.ts calls /api/exchange-token for hosted mode
- [ ] usage.ts calls /api/check-usage for hosted mode
- [ ] init.ts createOrg calls /api/create-org for hosted mode
- [ ] Community mode calls still use /functions/v1/

### US3 — Hosted Enrichment
- [ ] /api/enrich route deployed and responding
- [ ] Pending decisions enriched with type, summary, affects, confidence
- [ ] enriched_by = 'llm' set on enriched decisions
- [ ] Daily cost ceiling enforced
- [ ] Missing ANTHROPIC_API_KEY returns 503
- [ ] Community users get 403

### US4 — Community Mode Unchanged
- [ ] Community init prompts for 4 credentials (unchanged)
- [ ] Community API calls use supabaseUrl/functions/v1/
- [ ] Community enrichment uses local CLI
- [ ] All existing tests pass

### US5 — Remove Supabase EF Dependency
- [ ] Hosted mode works with all EFs disabled
- [ ] Each EF has deprecation header
- [ ] Stripe webhook URL documented for update
- [ ] EFs kept in repo for community use

