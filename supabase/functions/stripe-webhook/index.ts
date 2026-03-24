import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function respond(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Calculate period end based on billing cycle from the current date.
 */
function calculatePeriodEnd(billingCycle: string | undefined): string {
  const now = new Date();
  if (billingCycle === "annual") {
    now.setFullYear(now.getFullYear() + 1);
  } else {
    now.setMonth(now.getMonth() + 1);
  }
  return now.toISOString();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!stripeSecretKey || !webhookSecret) {
      console.error("STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not set");
      return respond({ error: "configuration_error" }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verify Stripe signature
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return respond({ error: "missing_signature" }, 400);
    }

    const body = await req.text();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      console.error(
        "Webhook signature verification failed:",
        (err as Error).message,
      );
      return respond({ error: "invalid_signature" }, 400);
    }

    // Handle event types
    switch (event.type) {
      // -----------------------------------------------------------------
      // checkout.session.completed — new subscription created
      // -----------------------------------------------------------------
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.org_id;
        const plan = session.metadata?.plan;
        const billingCycle = session.metadata?.billing_cycle;

        if (!orgId || !plan) {
          console.error("checkout.session.completed: missing org_id or plan in metadata");
          break;
        }

        // Upsert subscription
        await supabase.from("subscriptions").upsert(
          {
            org_id: orgId,
            plan,
            billing_cycle: billingCycle ?? "monthly",
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            status: "active",
            current_period_start: new Date().toISOString(),
            current_period_end: calculatePeriodEnd(billingCycle),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "org_id" },
        );

        // Update org plan
        await supabase.from("orgs").update({ plan }).eq("id", orgId);
        break;
      }

      // -----------------------------------------------------------------
      // customer.subscription.updated — plan/status change
      // -----------------------------------------------------------------
      case "customer.subscription.updated": {
        const subscription = event.data
          .object as Stripe.Subscription;
        const status =
          subscription.status === "past_due" ? "past_due" : "active";

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
      // customer.subscription.deleted — downgrade to free
      // -----------------------------------------------------------------
      case "customer.subscription.deleted": {
        const subscription = event.data
          .object as Stripe.Subscription;

        // Find org_id before updating
        const { data: sub } = await supabase
          .from("subscriptions")
          .select("org_id")
          .eq("stripe_subscription_id", subscription.id)
          .single();

        // Update subscription to cancelled/free
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
        if (sub) {
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

        if (sub) {
          await supabase
            .from("usage_overages")
            .update({ billed_at: new Date().toISOString() })
            .eq("org_id", sub.org_id)
            .is("billed_at", null);
        }
        break;
      }

      // -----------------------------------------------------------------
      // invoice.payment_failed — set past_due for grace period
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
        // Unhandled event type — acknowledge receipt
        break;
    }

    return respond({ received: true });
  } catch (err) {
    console.error("stripe-webhook error:", (err as Error).message);
    return respond({ error: "webhook_handler_error" }, 500);
  }
});
