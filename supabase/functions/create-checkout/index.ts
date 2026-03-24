import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

// ---------------------------------------------------------------------------
// T069 — create-checkout Edge Function
//
// Generates a Stripe Checkout URL for a plan upgrade.
// Returns { checkout_url }.
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function respond(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Stripe Price ID mapping (configured via env vars)
// ---------------------------------------------------------------------------

function getPriceId(plan: string, billingCycle: string): string {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${billingCycle.toUpperCase()}`;
  const priceId = Deno.env.get(key);
  if (!priceId) {
    throw new Error(`Missing Stripe price ID env var: ${key}`);
  }
  return priceId;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Auth check
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return respond({ error: "unauthorized" }, 401);
    }

    // 2. Parse request
    const {
      org_id,
      plan,
      billing_cycle = "monthly",
      success_url = "https://dashboard.teamind.dev/billing/success",
      cancel_url = "https://dashboard.teamind.dev/billing/cancel",
    } = await req.json() as {
      org_id: string;
      plan: string;
      billing_cycle?: string;
      success_url?: string;
      cancel_url?: string;
    };

    if (!org_id) {
      return respond({ error: "org_id_required" }, 400);
    }
    if (plan !== "team" && plan !== "business") {
      return respond({ error: "invalid_plan", message: "Plan must be 'team' or 'business'." }, 400);
    }
    if (billing_cycle !== "monthly" && billing_cycle !== "annual") {
      return respond({ error: "invalid_billing_cycle" }, 400);
    }

    // 3. Stripe + DB setup
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return respond({ error: "stripe_not_configured" }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-04-10" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 4. Get or create Stripe customer
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("org_id", org_id)
      .single();

    let customerId = sub?.stripe_customer_id as string | null;

    if (!customerId) {
      // Fetch org name for Stripe customer creation
      const { data: org } = await supabase
        .from("orgs")
        .select("name")
        .eq("id", org_id)
        .single();

      const customer = await stripe.customers.create({
        name: org?.name ?? "Unknown Org",
        metadata: { org_id },
      });
      customerId = customer.id;

      // Store customer ID (upsert subscription with free plan as baseline)
      await supabase.from("subscriptions").upsert(
        {
          org_id,
          plan: "free",
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id" },
      );
    }

    // 5. Create Checkout Session
    const priceId = getPriceId(plan, billing_cycle);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { org_id, plan, billing_cycle },
      success_url,
      cancel_url,
    });

    return respond({ checkout_url: session.url });
  } catch (err) {
    console.error("create-checkout error:", (err as Error).message);
    return respond(
      { error: "checkout_failed", message: (err as Error).message },
      500,
    );
  }
});
