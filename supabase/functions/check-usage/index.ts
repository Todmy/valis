import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeJwt } from "https://deno.land/x/jose@v5.2.0/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Plan limits (mirrored from packages/cli/src/billing/limits.ts)
// ---------------------------------------------------------------------------

interface PlanLimits {
  decisions: number;
  members: number;
  searches: number;
  overage: boolean;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { decisions: 500, members: 5, searches: 100, overage: false },
  team: { decisions: 5_000, members: 25, searches: 1_000, overage: true },
  business: { decisions: 25_000, members: 50, searches: 5_000, overage: true },
  enterprise: {
    decisions: Infinity,
    members: Infinity,
    searches: Infinity,
    overage: false,
  },
};

const OVERAGE_RATES = {
  decision_cents: 0.5,
  search_cents: 0.2,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function respond(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function upgradeMessage(plan: string): string {
  if (plan === "free") {
    return "Upgrade to Team ($29/mo) for 5,000 decisions and 1,000 searches/day.";
  }
  if (plan === "team") {
    return "Upgrade to Business ($99/mo) for 25,000 decisions and 5,000 searches/day.";
  }
  return "Contact sales for Enterprise pricing.";
}

function nextPlan(plan: string): "team" | "business" | null {
  if (plan === "free") return "team";
  if (plan === "team") return "business";
  return null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1. Extract org_id from JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return respond({ error: "unauthorized" }, 401);
    }

    const jwt = authHeader.slice(7).trim();
    let orgId: string;
    try {
      const claims = decodeJwt(jwt);
      orgId = claims.org_id as string;
      if (!orgId) {
        return respond({ error: "missing_org_id" }, 400);
      }
    } catch {
      return respond({ error: "invalid_token" }, 401);
    }

    const { operation } = await req.json();
    if (operation !== "store" && operation !== "search") {
      return respond({ error: "invalid_operation" }, 400);
    }

    // 2. Get subscription
    const { data: sub } = await supabase
      .from("subscriptions")
      .select(
        "plan, status, current_period_start, current_period_end, stripe_customer_id",
      )
      .eq("org_id", orgId)
      .single();

    const plan = sub?.plan ?? "free";
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS["free"];

    // 3. Get current usage from rate_limits
    const { data: usage } = await supabase
      .from("rate_limits")
      .select("decision_count, search_count_today, member_count")
      .eq("org_id", orgId)
      .single();

    const decisionCount = usage?.decision_count ?? 0;
    const searchCount = usage?.search_count_today ?? 0;
    const memberCount = usage?.member_count ?? 0;

    const usageInfo = {
      decisions: { used: decisionCount, limit: limits.decisions },
      searches: { used: searchCount, limit: limits.searches },
      members: { used: memberCount, limit: limits.members },
    };

    // 4. Check limits based on operation
    if (operation === "store" && decisionCount >= limits.decisions) {
      if (limits.overage) {
        // Track overage for paid plans
        if (sub) {
          await supabase.rpc("increment_usage_overage", {
            p_org_id: orgId,
            p_period_start: sub.current_period_start,
            p_period_end: sub.current_period_end,
            p_field: "extra_decisions",
            p_amount_cents: OVERAGE_RATES.decision_cents,
          });
        }
        return respond({
          allowed: true,
          plan,
          overage: true,
          overage_rate: `$${(OVERAGE_RATES.decision_cents / 100).toFixed(3)} per decision`,
          usage: {
            decisions: {
              ...usageInfo.decisions,
              overage: decisionCount - limits.decisions,
            },
            searches: usageInfo.searches,
          },
        });
      }

      // Free tier: hard block
      const next = nextPlan(plan);
      let checkoutUrl: string | null = null;
      if (next) {
        try {
          const checkoutRes = await fetch(
            `${supabaseUrl}/functions/v1/create-checkout`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                org_id: orgId,
                plan: next,
                billing_cycle: "monthly",
                success_url: "https://dashboard.teamind.dev/billing/success",
                cancel_url: "https://dashboard.teamind.dev/billing/cancel",
              }),
            },
          );
          if (checkoutRes.ok) {
            const checkoutData = await checkoutRes.json();
            checkoutUrl = checkoutData.checkout_url ?? null;
          }
        } catch {
          // Best-effort checkout URL generation
        }
      }

      return respond({
        allowed: false,
        plan,
        reason: `Free tier limit reached (${decisionCount}/${limits.decisions} decisions).`,
        upgrade: {
          message: upgradeMessage(plan),
          checkout_url: checkoutUrl,
        },
        usage: {
          decisions: usageInfo.decisions,
          searches: usageInfo.searches,
        },
      });
    }

    if (operation === "search" && searchCount >= limits.searches) {
      if (limits.overage) {
        // Track overage for paid plans
        if (sub) {
          await supabase.rpc("increment_usage_overage", {
            p_org_id: orgId,
            p_period_start: sub.current_period_start,
            p_period_end: sub.current_period_end,
            p_field: "extra_searches",
            p_amount_cents: OVERAGE_RATES.search_cents,
          });
        }
        return respond({
          allowed: true,
          plan,
          overage: true,
          overage_rate: `$${(OVERAGE_RATES.search_cents / 100).toFixed(3)} per search`,
          usage: {
            decisions: usageInfo.decisions,
            searches: {
              ...usageInfo.searches,
              overage: searchCount - limits.searches,
            },
          },
        });
      }

      // Free tier: hard block
      const next = nextPlan(plan);
      return respond({
        allowed: false,
        plan,
        reason: `Free tier limit reached (${searchCount}/${limits.searches} searches/day).`,
        upgrade: {
          message: upgradeMessage(plan),
          checkout_url: null,
        },
        usage: {
          decisions: usageInfo.decisions,
          searches: usageInfo.searches,
        },
      });
    }

    // 5. Within limits
    return respond({
      allowed: true,
      plan,
      usage: usageInfo,
    });
  } catch (err) {
    // Fail-open: on any internal error, allow the operation to proceed (FR-018).
    // Usage is still tracked in rate_limits by the store/search pipeline.
    console.error("check-usage error:", (err as Error).message);
    return respond({ allowed: true, error: "internal_error" });
  }
});
