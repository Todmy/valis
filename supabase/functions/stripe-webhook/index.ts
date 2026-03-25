/**
 * @deprecated Migrated to Vercel API route: packages/web/src/app/api/stripe-webhook/route.ts
 * This Edge Function is kept for community/self-hosted deployments only.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Calculate billing period end from start + billing cycle.
 * Monthly = +1 month, Annual = +1 year.
 */
function calculatePeriodEnd(
  billingCycle: string,
  fromDate?: Date,
): string {
  const start = fromDate ?? new Date();
  const end = new Date(start);
  if (billingCycle === "annual") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end.toISOString();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!stripeSecretKey || !webhookSecret) {
      console.error("stripe-webhook: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
      return jsonResponse({ error: "misconfigured" }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
    });

    // 1. Verify Stripe webhook signature
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return jsonResponse({ error: "missing_signature" }, 400);
    }

    const body = await req.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      console.error(
        "stripe-webhook: signature verification failed:",
        (err as Error).message,
      );
      return jsonResponse({ error: "invalid_signature" }, 400);
    }

    // 2. DB setup
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 3. Route by event type
    switch (event.type) {
      // -----------------------------------------------------------------
      // checkout.session.completed — new subscription created
      // -----------------------------------------------------------------
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.org_id;
        const plan = session.metadata?.plan;
        const billingCycle = session.metadata?.billing_cycle ?? "monthly";

        if (!orgId || !plan) {
          console.error(
            "stripe-webhook: checkout.session.completed missing metadata",
          );
          break;
        }

        const now = new Date().toISOString();

        // Upsert subscription record
        await supabase.from("subscriptions").upsert(
          {
            org_id: orgId,
            plan,
            billing_cycle: billingCycle,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            status: "active",
            current_period_start: now,
            current_period_end: calculatePeriodEnd(billingCycle),
            updated_at: now,
          },
          { onConflict: "org_id" },
        );

        // Update org plan
        await supabase.from("orgs").update({ plan }).eq("id", orgId);
        break;
      }

      // -----------------------------------------------------------------
      // customer.subscription.updated — plan change, renewal, status sync
      // -----------------------------------------------------------------
      case "customer.subscription.updated": {
        const subscription = event.data
          .object as Stripe.Subscription;

        const status = subscription.status === "past_due"
          ? "past_due"
          : "active";

        await supabase
          .from("subscriptions")
          .update({
            status,
            current_period_start: new Date(
              subscription.current_period_start * 1000,
            ).toISOString(),
            current_period_end: new Date(
              subscription.current_period_end * 1000,
            ).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);
        break;
      }

      // -----------------------------------------------------------------
      // customer.subscription.deleted — cancelled, downgrade to free
      // -----------------------------------------------------------------
      case "customer.subscription.deleted": {
        const subscription = event.data
          .object as Stripe.Subscription;

        // Look up org_id BEFORE updating (the record still exists)
        const { data: sub } = await supabase
          .from("subscriptions")
          .select("org_id")
          .eq("stripe_subscription_id", subscription.id)
          .single();

        // Downgrade subscription record
        await supabase
          .from("subscriptions")
          .update({
            plan: "free",
            status: "cancelled",
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        // Downgrade org plan
        if (sub?.org_id) {
          await supabase
            .from("orgs")
            .update({ plan: "free" })
            .eq("id", sub.org_id);
        }
        break;
      }

      // -----------------------------------------------------------------
      // invoice.paid — mark overages as billed
      // -----------------------------------------------------------------
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const { data: sub } = await supabase
          .from("subscriptions")
          .select("org_id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (sub?.org_id) {
          await supabase
            .from("usage_overages")
            .update({ billed_at: new Date().toISOString() })
            .eq("org_id", sub.org_id)
            .is("billed_at", null);
        }
        break;
      }

      // -----------------------------------------------------------------
      // invoice.payment_failed — set past_due (grace period starts)
      // -----------------------------------------------------------------
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await supabase
          .from("subscriptions")
          .update({
            status: "past_due",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);
        break;
      }

      default:
        // Unhandled event type — acknowledge but ignore
        console.log(`stripe-webhook: unhandled event type ${event.type}`);
        break;
    }

    // Always return 200 so Stripe does not retry handled events
    return jsonResponse({ received: true }, 200);
  } catch (err) {
    console.error("stripe-webhook error:", (err as Error).message);
    // Return 500 so Stripe retries on unexpected errors
    return jsonResponse(
      { error: "webhook_handler_error", message: (err as Error).message },
      500,
    );
  }
});
