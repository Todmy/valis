# Data Model: Search Intelligence, Data Quality & Growth

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-24
**Extends**: `/specs/002-retention-enterprise/data-model.md`

## Schema Changes (Migration 003)

All changes are additive. No columns removed or types changed.
Backward compatible with migration 001 (MVP) and 002 (Retention).

**Note**: The existing `orgs.plan` CHECK constraint from 001_init.sql
uses `('free','pro','enterprise')`. Migration 003 MUST update this:
```sql
ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_plan_check;
ALTER TABLE orgs ADD CONSTRAINT orgs_plan_check
  CHECK (plan IN ('free', 'team', 'business', 'enterprise'));
UPDATE orgs SET plan = 'team' WHERE plan = 'pro';
```
The value `'pro'` is renamed to `'team'` to align with the new pricing
tiers. Existing rows are migrated via UPDATE.

### Decision (extended)

| Field | Type | Constraints | Change |
|-------|------|-------------|--------|
| pinned | boolean | NOT NULL, DEFAULT false | ADD |
| enriched_by | text | nullable, CHECK in ('llm', 'manual') | ADD |

**pinned**: When `true`, the decision is exempt from confidence decay
in search ranking. Only admins can set this via `valis_lifecycle`
with `action: 'pin'`. Audit entry created on change.

**enriched_by**: Tracks how a pending decision was classified. `'llm'`
when enriched by the LLM pipeline, `'manual'` when reclassified by a
user. `NULL` for decisions that were classified at store time (normal
flow). Allows agents and users to know the provenance of classification.

**source CHECK expansion**: The existing `source` column CHECK
constraint is expanded to include `'synthesis'` as a valid value:
```sql
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_source_check;
ALTER TABLE decisions ADD CONSTRAINT decisions_source_check
  CHECK (source IN ('mcp_store', 'file_watcher', 'stop_hook', 'seed', 'synthesis'));
```

Pattern decisions created by the synthesis algorithm use
`source: 'synthesis'`. The `type` for these decisions is `'pattern'`.

**Indexes**:
- `decisions.pinned` (partial where `pinned = true`) — fast lookup of
  pinned decisions for reranking boost.

### Subscription (new)

Tracks billing plan for each organization.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, auto-generated |
| org_id | UUID | NOT NULL, FK -> orgs.id, UNIQUE |
| plan | text | NOT NULL, CHECK in ('free', 'team', 'business', 'enterprise') |
| billing_cycle | text | NOT NULL, CHECK in ('monthly', 'annual'), DEFAULT 'monthly' |
| stripe_customer_id | text | nullable, UNIQUE |
| stripe_subscription_id | text | nullable, UNIQUE |
| status | text | NOT NULL, CHECK in ('active', 'past_due', 'cancelled', 'trialing'), DEFAULT 'active' |
| current_period_start | timestamptz | nullable |
| current_period_end | timestamptz | nullable |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |

**org_id**: One subscription per org (UNIQUE constraint). Every org
starts with plan `'free'` and no Stripe IDs.

**stripe_customer_id / stripe_subscription_id**: Set when the org
upgrades via Stripe Checkout. Null for free tier orgs that have never
entered billing.

**status**: Mirrors Stripe subscription status. `past_due` triggers
a 7-day grace period. `cancelled` after grace period expires —
org is downgraded to free limits.

**Indexes**:
- `subscriptions.org_id` (unique)
- `subscriptions.stripe_customer_id` (unique, partial where NOT NULL)
- `subscriptions.stripe_subscription_id` (unique, partial where NOT NULL)

### UsageOverage (new)

Tracks overage charges for paid plans that exceed their limits.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, auto-generated |
| org_id | UUID | NOT NULL, FK -> orgs.id |
| period_start | timestamptz | NOT NULL |
| period_end | timestamptz | NOT NULL |
| extra_decisions | integer | NOT NULL, DEFAULT 0 |
| extra_searches | integer | NOT NULL, DEFAULT 0 |
| amount_cents | integer | NOT NULL, DEFAULT 0 |
| billed_at | timestamptz | nullable |

**period_start / period_end**: Matches the Stripe billing period from
the subscription. One overage record per org per billing period.

**extra_decisions / extra_searches**: Count of operations beyond the
plan limit for this period.

**amount_cents**: Calculated overage amount. `extra_decisions * 0.5 +
extra_searches * 0.2` (in cents). Updated incrementally as overages
accumulate.

**billed_at**: Set when the overage is billed via Stripe at period
end. Null while the period is active.

**Index**: `usage_overages.org_id` + `usage_overages.period_end` DESC
(for current period lookup).

**Uniqueness**: `(org_id, period_start)` unique — one overage record
per org per period.

### EnrichmentUsage (new)

Tracks LLM enrichment cost per org per day for ceiling enforcement.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | Primary key, auto-generated |
| org_id | UUID | NOT NULL, FK -> orgs.id |
| date | date | NOT NULL |
| provider | text | NOT NULL |
| decisions_enriched | integer | NOT NULL, DEFAULT 0 |
| tokens_used | integer | NOT NULL, DEFAULT 0 |
| cost_cents | integer | NOT NULL, DEFAULT 0 |

**Uniqueness**: `(org_id, date, provider)` unique — one record per
org per day per provider.

**Ceiling check**: `SELECT cost_cents FROM enrichment_usage WHERE
org_id = $1 AND date = CURRENT_DATE`. If sum >= configured ceiling
(default 100 cents), enrichment stops for the day.

## Plan Limits (Constants)

Plan limits are enforced at the application level (check-usage Edge
Function) using the following constants. Stored as application
constants, not in a database table — simplifies queries and avoids
an extra join.

| Plan | Max Decisions | Max Members | Max Searches/Day | Overage Enabled | Decision Overage Rate | Search Overage Rate |
|------|--------------|-------------|-------------------|-----------------|----------------------|---------------------|
| free | 500 | 5 | 100 | No | N/A | N/A |
| team | 5,000 | 25 | 1,000 | Yes | $0.005/decision | $0.002/search |
| business | 25,000 | 50 | 5,000 | Yes | $0.005/decision | $0.002/search |
| enterprise | unlimited | unlimited | unlimited | N/A | Custom | Custom |

```typescript
export const PLAN_LIMITS = {
  free:       { decisions: 500,    members: 5,   searches: 100,   overage: false },
  team:       { decisions: 5_000,  members: 25,  searches: 1_000, overage: true  },
  business:   { decisions: 25_000, members: 50,  searches: 5_000, overage: true  },
  enterprise: { decisions: Infinity, members: Infinity, searches: Infinity, overage: false },
} as const;

export const OVERAGE_RATES = {
  decision_cents: 0.5,  // $0.005 per decision
  search_cents: 0.2,    // $0.002 per search
} as const;
```

## Relationships (updated)

```
Organization 1 ---- * Member (unchanged from Phase 2)
Organization 1 ---- * Decision (gains pinned, enriched_by)
Organization 1 ---- * AuditEntry (unchanged from Phase 2)
Organization 1 ---- * Contradiction (unchanged from Phase 2)
Organization 1 ---- * RateLimit (unchanged)
Organization 1 ---- 1 Subscription (new)
Organization 1 ---- * UsageOverage (new)
Organization 1 ---- * EnrichmentUsage (new)

Decision 1 ---- 0..1 Decision (replaces -> superseded, from Phase 2)
Decision 1 ---- * Decision (depends_on, array, from Phase 2)
Decision * ---- * Contradiction (via decision_a_id, decision_b_id, from Phase 2)
```

## State Transitions (updated)

### Decision.status (extended from Phase 2)

```
proposed -> active       (any member can promote)
active -> deprecated     (any member)
active -> superseded     (admin or original author, via replaces)
```

No new status values. The `proposed` workflow (US1) uses existing
transitions. Pinning does not change status — it is an orthogonal
boolean flag.

### Decision Lifecycle Actions (extended)

New actions added to `LifecycleAction` type:
- `pin`: Admin-only. Sets `pinned = true`. Creates audit entry
  `decision_pinned`.
- `unpin`: Admin-only. Sets `pinned = false`. Creates audit entry
  `decision_unpinned`.

New audit actions added to `AuditAction` type:
- `decision_pinned`
- `decision_unpinned`
- `decision_enriched`
- `decision_auto_deduped`
- `pattern_synthesized`

### Subscription.status

```
active -> past_due      (payment failed)
past_due -> active      (payment recovered)
past_due -> cancelled   (grace period expired, 7 days)
cancelled -> active     (resubscribed via Checkout)
trialing -> active      (trial ended, payment succeeded)
trialing -> cancelled   (trial ended, no payment)
```

## Validation Rules (new)

- `decisions.pinned`: boolean, defaults to `false`. Only admin role
  can set to `true` (enforced at application level).
- `decisions.enriched_by`: must be `'llm'` or `'manual'` when set.
  Null is valid (not enriched).
- `decisions.source`: must be one of `'mcp_store'`, `'file_watcher'`,
  `'stop_hook'`, `'seed'`, `'synthesis'`.
- `subscriptions.plan`: must be one of `'free'`, `'team'`,
  `'business'`, `'enterprise'`.
- `subscriptions.billing_cycle`: must be `'monthly'` or `'annual'`.
- `subscriptions.status`: must be one of `'active'`, `'past_due'`,
  `'cancelled'`, `'trialing'`.
- `usage_overages`: `period_start < period_end`.
- `usage_overages`: `extra_decisions >= 0`, `extra_searches >= 0`,
  `amount_cents >= 0`.

## RLS Policy Changes

### Subscriptions

```sql
-- Read: org members can view their own subscription
CREATE POLICY subscriptions_read_jwt ON subscriptions
  FOR SELECT
  USING (org_id::text = (select auth.jwt()->>'org_id'));

-- Write: service_role only (Edge Functions handle mutations)
-- No INSERT/UPDATE policy for authenticated role
```

### UsageOverages

```sql
-- Read: org admins can view overages
CREATE POLICY overages_read_jwt ON usage_overages
  FOR SELECT
  USING (org_id::text = (select auth.jwt()->>'org_id'));

-- Write: service_role only
```

### EnrichmentUsage

```sql
-- Read: org members can view enrichment usage
CREATE POLICY enrichment_read_jwt ON enrichment_usage
  FOR SELECT
  USING (org_id::text = (select auth.jwt()->>'org_id'));

-- Write: service_role only
```

## Qdrant Payload Changes

The Qdrant `decisions` collection payload gains one new field:

| Field | Type | Purpose |
|-------|------|---------|
| pinned | boolean | Included in payload for reranking signal |

The `pinned` field is replicated to Qdrant payload on store and on
pin/unpin lifecycle actions. This allows the reranking pipeline to
access pin status without a Postgres round-trip.

## Data Volume Assumptions (Phase 3)

| Metric | Expected range |
|--------|---------------|
| Subscriptions per org | 1 (exactly one) |
| Usage overage records per org/month | 0-1 |
| Enrichment usage records per org/day | 0-1 per provider |
| Pattern decisions per org | 0-20 |
| Pinned decisions per org | 0-50 |
| Enriched decisions per org | 0-500 (30% of total) |
| Near-duplicate pairs per cleanup run | 0-50 |
| Orphan (stale pending) decisions per org | 0-100 |
