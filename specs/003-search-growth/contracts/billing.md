# Contract: Usage-Based Pricing & Billing

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-24
**Implements**: FR-016, FR-017, FR-018

## Overview

Enforce plan limits on store and search operations. Integrate Stripe
for plan upgrades, subscription management, and overage billing.
Billing failures never block core operations (FR-018).

## Module Locations

```
packages/cli/src/
├── billing/
│   ├── limits.ts            # Plan limit constants + check logic
│   └── usage.ts             # Usage tracking helpers

supabase/functions/
├── check-usage/
│   └── index.ts             # Edge Function: usage check before store/search
├── stripe-webhook/
│   └── index.ts             # Edge Function: Stripe webhook handler
└── create-checkout/
    └── index.ts             # Edge Function: generate Stripe Checkout URL
```

## Plan Limit Constants

```typescript
export interface PlanLimits {
  decisions: number;
  members: number;
  searches: number;  // Per day
  overage: boolean;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free:       { decisions: 500,      members: 5,        searches: 100,     overage: false },
  team:       { decisions: 5_000,    members: 25,       searches: 1_000,   overage: true  },
  business:   { decisions: 25_000,   members: 50,       searches: 5_000,   overage: true  },
  enterprise: { decisions: Infinity, members: Infinity,  searches: Infinity, overage: false },
};

export const PLAN_PRICES = {
  team:     { monthly: 2500, annual: 24000 },   // cents
  business: { monthly: 9900, annual: 95000 },   // cents (annual = ~20% discount)
} as const;

export const OVERAGE_RATES = {
  decision_cents: 0.5,   // $0.005 per extra decision
  search_cents: 0.2,     // $0.002 per extra search
} as const;
```

---

## Edge Function: check-usage

**Endpoint**: `POST /functions/v1/check-usage`

**Called by**: CLI store and search operations, before executing the
actual operation. Also callable by the web dashboard for usage display.

### Request

```typescript
interface CheckUsageRequest {
  org_id: string;
  operation: 'store' | 'search';
}
```

**Auth**: JWT Bearer token (extracts `org_id` from claims).

### Response (within limits)

```typescript
interface UsageAllowedResponse {
  allowed: true;
  plan: string;
  usage: {
    decisions: { used: number; limit: number };
    searches: { used: number; limit: number };
    members: { used: number; limit: number };
  };
}
```

### Response (limit reached, no overage)

```typescript
interface UsageDeniedResponse {
  allowed: false;
  plan: string;
  reason: string;  // "Free tier limit reached (500/500 decisions)."
  upgrade: {
    message: string;  // "Upgrade to Team ($25/mo) for 5,000 decisions."
    checkout_url: string | null;  // Stripe Checkout URL for upgrade
  };
  usage: {
    decisions: { used: number; limit: number };
    searches: { used: number; limit: number };
  };
}
```

### Response (limit reached, overage enabled)

```typescript
interface UsageOverageResponse {
  allowed: true;
  plan: string;
  overage: true;
  overage_rate: string;  // "$0.005 per decision"
  usage: {
    decisions: { used: number; limit: number; overage: number };
    searches: { used: number; limit: number; overage: number };
  };
}
```

### Implementation

```typescript
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. Extract org_id from JWT
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  const claims = decodeJwt(jwt);
  const orgId = claims.org_id;

  const { operation } = await req.json();

  // 2. Get subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_start, current_period_end')
    .eq('org_id', orgId)
    .single();

  const plan = sub?.plan ?? 'free';
  const limits = PLAN_LIMITS[plan];

  // 3. Get current usage from rate_limits
  const { data: usage } = await supabase
    .from('rate_limits')
    .select('decision_count, search_count_today, member_count')
    .eq('org_id', orgId)
    .single();

  const decisionCount = usage?.decision_count ?? 0;
  const searchCount = usage?.search_count_today ?? 0;

  // 4. Check limits
  if (operation === 'store' && decisionCount >= limits.decisions) {
    if (limits.overage) {
      // Track overage
      await incrementOverage(supabase, orgId, sub, 'decision');
      return respond({ allowed: true, overage: true, /* ... */ });
    }
    // Generate Checkout URL for upgrade
    const checkoutUrl = await createCheckoutUrl(orgId, plan);
    return respond({ allowed: false, reason: `...`, upgrade: { checkout_url: checkoutUrl } });
  }

  if (operation === 'search' && searchCount >= limits.searches) {
    if (limits.overage) {
      await incrementOverage(supabase, orgId, sub, 'search');
      return respond({ allowed: true, overage: true, /* ... */ });
    }
    return respond({ allowed: false, reason: `...`, upgrade: { /* ... */ } });
  }

  // 5. Within limits
  return respond({ allowed: true, plan, usage: { /* ... */ } });
});
```

### Non-Blocking Integration

The CLI calls `check-usage` before store/search but wraps it in a
try-catch. If the call fails for any reason (network, Edge Function
error, timeout), the operation proceeds:

```typescript
async function checkUsageOrProceed(
  orgId: string,
  operation: 'store' | 'search',
): Promise<{ allowed: boolean; message?: string }> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/check-usage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId, operation }),
      signal: AbortSignal.timeout(3000), // 3s timeout
    });

    if (!response.ok) return { allowed: true }; // Fail open
    return response.json();
  } catch {
    // Network error, timeout, etc. — never block the operation
    return { allowed: true };
  }
}
```

**Fail-open guarantee** (FR-018): If `check-usage` is unreachable,
the operation proceeds. Usage is still tracked in `rate_limits` by
the store/search pipeline. Billing reconciliation happens
asynchronously.

---

## Edge Function: stripe-webhook

**Endpoint**: `POST /functions/v1/stripe-webhook`

**Called by**: Stripe (webhook delivery).

### Webhook Verification

```typescript
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const sig = req.headers.get('stripe-signature')!;
const body = await req.text();
const event = stripe.webhooks.constructEvent(
  body,
  sig,
  Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
);
```

### Event Handlers

#### `checkout.session.completed`

```typescript
case 'checkout.session.completed': {
  const session = event.data.object;
  const orgId = session.metadata.org_id;
  const plan = session.metadata.plan;

  // Upsert subscription
  await supabase.from('subscriptions').upsert({
    org_id: orgId,
    plan,
    billing_cycle: session.metadata.billing_cycle ?? 'monthly',
    stripe_customer_id: session.customer,
    stripe_subscription_id: session.subscription,
    status: 'active',
    current_period_start: new Date().toISOString(),
    current_period_end: calculatePeriodEnd(session.metadata.billing_cycle),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id' });

  // Update org plan
  await supabase.from('orgs').update({ plan }).eq('id', orgId);
  break;
}
```

#### `customer.subscription.updated`

```typescript
case 'customer.subscription.updated': {
  const subscription = event.data.object;
  await supabase.from('subscriptions').update({
    status: subscription.status === 'past_due' ? 'past_due' : 'active',
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('stripe_subscription_id', subscription.id);
  break;
}
```

#### `customer.subscription.deleted`

```typescript
case 'customer.subscription.deleted': {
  const subscription = event.data.object;

  // Downgrade to free
  await supabase.from('subscriptions').update({
    plan: 'free',
    status: 'cancelled',
    stripe_subscription_id: null,
    updated_at: new Date().toISOString(),
  }).eq('stripe_subscription_id', subscription.id);

  // Update org plan
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('org_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();
  if (sub) {
    await supabase.from('orgs').update({ plan: 'free' }).eq('id', sub.org_id);
  }
  break;
}
```

#### `invoice.paid`

```typescript
case 'invoice.paid': {
  const invoice = event.data.object;
  const customerId = invoice.customer;

  // Mark overages as billed for the completed period
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('org_id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (sub) {
    await supabase.from('usage_overages').update({
      billed_at: new Date().toISOString(),
    }).eq('org_id', sub.org_id).is('billed_at', null);
  }
  break;
}
```

#### `invoice.payment_failed`

```typescript
case 'invoice.payment_failed': {
  const invoice = event.data.object;
  const customerId = invoice.customer;

  // Start 7-day grace period by setting status to past_due
  await supabase.from('subscriptions').update({
    status: 'past_due',
    updated_at: new Date().toISOString(),
  }).eq('stripe_customer_id', customerId);
  break;
}
```

### Grace Period Enforcement

A scheduled job (or Stripe's built-in dunning) handles the 7-day
grace period. After 7 days of `past_due`, the subscription is
cancelled via Stripe, which triggers `customer.subscription.deleted`
and the automatic downgrade to free tier.

---

## Edge Function: create-checkout

**Endpoint**: `POST /functions/v1/create-checkout`

**Called by**: CLI (`valis upgrade`) or dashboard (upgrade link).

### Request

```typescript
interface CreateCheckoutRequest {
  org_id: string;
  plan: 'team' | 'business';
  billing_cycle: 'monthly' | 'annual';
  success_url: string;
  cancel_url: string;
}
```

### Response

```typescript
interface CreateCheckoutResponse {
  checkout_url: string;
}
```

### Implementation

```typescript
Deno.serve(async (req: Request) => {
  const supabase = createClient(/* ... */);
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

  const { org_id, plan, billing_cycle, success_url, cancel_url } = await req.json();

  // Get or create Stripe customer
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('org_id', org_id)
    .single();

  let customerId = sub?.stripe_customer_id;
  if (!customerId) {
    const { data: org } = await supabase
      .from('orgs')
      .select('name')
      .eq('id', org_id)
      .single();

    const customer = await stripe.customers.create({
      name: org?.name,
      metadata: { org_id },
    });
    customerId = customer.id;

    // Store customer ID
    await supabase.from('subscriptions').upsert({
      org_id,
      plan: 'free',
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' });
  }

  // Create Checkout Session
  const priceId = getPriceId(plan, billing_cycle); // Maps to Stripe Price IDs
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { org_id, plan, billing_cycle },
    success_url,
    cancel_url,
  });

  return new Response(JSON.stringify({ checkout_url: session.url }));
});
```

---

## CLI Integration

### Store Pipeline

```typescript
// In packages/cli/src/mcp/tools/store.ts
async function handleStore(args: StoreArgs): Promise<StoreResponse> {
  const config = await loadConfig();

  // Check usage (non-blocking)
  const usage = await checkUsageOrProceed(config.org_id, 'store');
  if (!usage.allowed) {
    return {
      id: '',
      status: 'blocked' as never,
      error: usage.message,
      upgrade: usage.upgrade,
    };
  }

  // Proceed with normal store pipeline...
}
```

### Search Pipeline

```typescript
// In packages/cli/src/mcp/tools/search.ts
async function handleSearch(args: SearchArgs): Promise<SearchResponse> {
  const config = await loadConfig();

  // Check usage (non-blocking)
  const usage = await checkUsageOrProceed(config.org_id, 'search');
  if (!usage.allowed) {
    return {
      results: [],
      note: usage.message,
      upgrade: usage.upgrade,
    };
  }

  // Proceed with normal search pipeline...
}
```

### Upgrade Command

```
valis upgrade [--plan team|business] [--annual]
```

Opens the Stripe Checkout URL in the user's default browser:

```typescript
async function handleUpgrade(options: UpgradeOptions): Promise<void> {
  const config = await loadConfig();
  const response = await fetch(`${config.supabase_url}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      org_id: config.org_id,
      plan: options.plan ?? 'team',
      billing_cycle: options.annual ? 'annual' : 'monthly',
      success_url: 'https://dashboard.valis.dev/billing/success',
      cancel_url: 'https://dashboard.valis.dev/billing/cancel',
    }),
  });

  const { checkout_url } = await response.json();
  await open(checkout_url); // Opens in default browser
  console.log(`Opening billing portal: ${checkout_url}`);
}
```

---

## Overage Tracking

When a paid org exceeds plan limits and overage is enabled:

```typescript
async function incrementOverage(
  supabase: SupabaseClient,
  orgId: string,
  subscription: Subscription,
  type: 'decision' | 'search',
): Promise<void> {
  const field = type === 'decision' ? 'extra_decisions' : 'extra_searches';
  const rate = type === 'decision'
    ? OVERAGE_RATES.decision_cents
    : OVERAGE_RATES.search_cents;

  // Upsert for current period
  await supabase.rpc('increment_usage_overage', {
    p_org_id: orgId,
    p_period_start: subscription.current_period_start,
    p_period_end: subscription.current_period_end,
    p_field: field,
    p_amount_cents: rate,
  });
}
```

## Error Handling

- **Stripe API errors**: Logged, never exposed to user. Billing
  operations fail gracefully.
- **Webhook signature verification failure**: Return 400. Stripe
  retries automatically (up to 3 days).
- **Edge Function timeout**: 10s limit. Checkout URL generation and
  webhook processing are well within this.
- **Database errors**: Logged. Webhook handler returns 500 so Stripe
  retries.

## Testing Strategy

- **check-usage**: Unit tests with mock subscription/rate_limits data.
  Test free limit, paid overage, enterprise unlimited, fail-open.
- **stripe-webhook**: Unit tests for each event type with mock Stripe
  events. Verify subscription state transitions.
- **create-checkout**: Unit tests with mock Stripe API. Verify
  customer creation, session creation, metadata.
- **CLI integration**: Mock check-usage responses. Verify store/search
  behavior on allowed, denied, and error responses.
- **E2E**: Stripe test mode with test clock for subscription lifecycle.
