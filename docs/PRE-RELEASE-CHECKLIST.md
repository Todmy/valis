# VALIS Pre-Release Checklist

Manual steps required before production deployment.

## 1. Supabase Setup

```bash
# Deploy all migrations (from project root)
supabase db push
```

Migrations applied: 001_init → 002_retention → 003_search_growth → 004_multi_project → 005_registration_api → 006_org_created_audit → 007_increment_rate_limit

**Optional (defer after dog-fooding):**
- Enable Realtime: Dashboard → Settings → API → Realtime (for cross-session push)

## 2. Qdrant Cloud

- Verify `decisions` collection exists (created automatically by `valis init`)
- Schema: 384d cosine vectors + BM25 sparse vectors
- Payload indexes: `org_id`, `type`, `project_id`

## 3. Vercel Deployment

```bash
cd packages/web
vercel link
vercel deploy --prod
```

### Environment Variables (set in Vercel Dashboard → Settings → Environment Variables)

**Required:**
| Variable | How to get |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API Keys → Secret key |
| `JWT_SECRET` | Generate: `openssl rand -hex 32` |
| `QDRANT_URL` | Qdrant Cloud Dashboard → Cluster URL |
| `QDRANT_API_KEY` | Qdrant Cloud Dashboard → API Keys |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as SUPABASE_URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API Keys → Publishable key |

**Billing (when ready):**
| Variable | How to get |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → Signing secret |
| `STRIPE_PRICE_TEAM_MONTHLY` | Stripe Dashboard → Products → Team → Monthly price ID |
| `STRIPE_PRICE_TEAM_ANNUAL` | Stripe Dashboard → Products → Team → Annual price ID |
| `STRIPE_PRICE_BUSINESS_MONTHLY` | Stripe Dashboard → Products → Business → Monthly price ID |
| `STRIPE_PRICE_BUSINESS_ANNUAL` | Stripe Dashboard → Products → Business → Annual price ID |

**Enrichment (optional):**
| Variable | Default |
|---|---|
| `ANTHROPIC_API_KEY` | Required for /api/enrich to work |
| `ENRICHMENT_DAILY_BUDGET_CENTS` | `100` ($1.00/day per org) |

## 4. Stripe Setup (when ready for billing)

1. Create products: **Team** ($8/seat/mo), **Business** ($16/seat/mo)
2. Create prices: monthly + annual (20% discount) for each
3. Create webhook endpoint: `https://valis.krukit.co/api/stripe-webhook`
4. Events to listen: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
5. Copy webhook signing secret → Vercel env `STRIPE_WEBHOOK_SECRET`

## 5. DNS

Point `valis.krukit.co` → Vercel (CNAME to `cname.vercel-dns.com`)

## 6. CLI

```bash
# Build and link locally
cd packages/cli
pnpm build
npm link

# Test the full flow
valis init          # hosted mode
valis serve &       # start MCP server
# → store a decision via Claude Code / Cursor
# → search for it
valis status        # check connectivity
valis dashboard     # open web dashboard
```

## 7. Post-Deploy Verification

- [ ] `valis init` completes (hosted mode, zero-config)
- [ ] Store a decision → appears in Postgres + Qdrant
- [ ] Search returns stored decision
- [ ] Web dashboard shows decisions at valis.krukit.co
- [ ] Enrichment works (`valis enrich`)
- [ ] Rate limits trigger after exceeding quota
- [ ] Check Vercel logs for errors

## 8. Security Checklist

- [ ] Old Supabase service_role key revoked
- [ ] Old Qdrant API key rotated
- [ ] No secrets in git history (`git log -p -S 'sb_secret' | head` returns nothing)
- [ ] Rate limiting verified (hit free tier limit, confirm block)
- [ ] JWT_SECRET is unique, not shared with any other service
