/**
 * T015: POST /api/create-checkout — Create a Stripe checkout session.
 *
 * Authenticated via Bearer token (API key or JWT).
 */

import { type NextRequest } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, badRequest, unauthorized } from '@/lib/api-response';
import { extractBearerToken, authenticateApiKey } from '@/lib/api-auth';

function getPriceId(plan: string, billingCycle: string): string {
  const envKey = `STRIPE_PRICE_${plan.toUpperCase()}_${billingCycle.toUpperCase()}`;
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new Error(`Missing Stripe price ID for ${plan}/${billingCycle}. Set ${envKey} env var.`);
  }
  return priceId;
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate first (before checking Stripe config)
    const token = extractBearerToken(request);
    if (!token) {
      return unauthorized();
    }

    const supabase = createServerClient();
    const auth = await authenticateApiKey(supabase, token);
    if (!auth) {
      return unauthorized();
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      console.error('create-checkout: missing STRIPE_SECRET_KEY');
      return jsonResponse({ error: 'misconfigured' }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' as Stripe.LatestApiVersion });

    // Parse request
    const { org_id, plan, billing_cycle, success_url, cancel_url } = await request.json();

    if (!org_id || !plan) {
      return badRequest('missing_parameters');
    }

    if (plan !== 'team' && plan !== 'business') {
      return jsonResponse({ error: 'invalid_plan', message: "Plan must be 'team' or 'business'" }, 400);
    }

    const cycle = billing_cycle === 'annual' ? 'annual' : 'monthly';

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
        name: org?.name ?? `Org ${org_id}`,
        metadata: { org_id },
      });
      customerId = customer.id;

      await supabase.from('subscriptions').upsert(
        {
          org_id,
          plan: 'free',
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id' },
      );
    }

    // Resolve Stripe Price ID
    const priceId = getPriceId(plan, cycle);

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { org_id, plan, billing_cycle: cycle },
      success_url: success_url ?? 'https://dashboard.valis.dev/billing/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancel_url ?? 'https://dashboard.valis.dev/billing/cancel',
    });

    return jsonResponse({ checkout_url: session.url }, 200);
  } catch (err) {
    console.error('create-checkout error:', (err as Error).message);
    return jsonResponse({ error: 'checkout_failed', message: (err as Error).message }, 500);
  }
}
