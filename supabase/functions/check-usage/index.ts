/**
 * @deprecated Migrated to Vercel API route: packages/web/src/app/api/check-usage/route.ts
 * This Edge Function is kept for community/self-hosted deployments only.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Plan limits (mirrors packages/cli/src/billing/limits.ts for Deno runtime)
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

const PLAN_UPGRADE_NAMES: Record<string, { next: string; price: string }> = {
  free: { next: "Team", price: "$29/mo" },
  team: { next: "Business", price: "$99/mo" },
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

/** Decode JWT payload without verification (verification done by Supabase gateway). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const payload = parts[1];
  const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(decoded);
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1. Extract org_id and project_id from JWT or request body (T017)
    const authHeader = req.headers.get("authorization") ?? "";
    let orgId: string | undefined;
    let projectId: string | undefined;

    if (authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      try {
        const claims = decodeJwtPayload(token);
        orgId = claims.org_id as string | undefined;
        projectId = claims.project_id as string | undefined;
      } catch {
        // JWT decode failed — try request body
      }
    }

    const body = await req.json();
    const operation: string = body.operation;

    // Allow org_id and project_id from body as fallback (for service-to-service calls)
    if (!orgId) {
      orgId = body.org_id;
    }
    if (!projectId) {
      projectId = body.project_id;
    }

    if (!orgId || !operation) {
      return jsonResponse({ error: "missing_parameters" }, 400);
    }

    if (operation !== "store" && operation !== "search") {
      return jsonResponse({ error: "invalid_operation" }, 400);
    }

    // 2. Get subscription (if any)
    const { data: sub } = await supabase
      .from("subscriptions")
      .select(
        "plan, status, current_period_start, current_period_end",
      )
      .eq("org_id", orgId)
      .single();

    const plan = sub?.plan ?? "free";
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

    // 3. Get current usage from rate_limits
    const { data: usage } = await supabase
      .from("rate_limits")
      .select("decision_count, search_count_today, member_count")
      .eq("org_id", orgId)
      .single();

    const decisionCount = usage?.decision_count ?? 0;
    const searchCount = usage?.search_count_today ?? 0;
    const memberCount = usage?.member_count ?? 0;

    // 4. Enterprise — always allowed, no limit checks
    if (plan === "enterprise") {
      return jsonResponse(
        {
          allowed: true,
          plan,
          usage: {
            decisions: { used: decisionCount, limit: limits.decisions },
            searches: { used: searchCount, limit: limits.searches },
            members: { used: memberCount, limit: limits.members },
          },
        },
        200,
      );
    }

    // 5. Check store limits
    if (operation === "store" && decisionCount >= limits.decisions) {
      if (limits.overage) {
        // Paid plan — track overage, allow operation
        try {
          await supabase.rpc("increment_usage_overage", {
            p_org_id: orgId,
            p_period_start: sub?.current_period_start ??
              new Date().toISOString(),
            p_period_end: sub?.current_period_end ?? new Date().toISOString(),
            p_field: "extra_decisions",
            p_amount_cents: OVERAGE_RATES.decision_cents,
          });
        } catch {
          // Overage tracking failure — never block the operation
        }

        return jsonResponse(
          {
            allowed: true,
            plan,
            overage: true,
            overage_rate: `$${(OVERAGE_RATES.decision_cents / 100).toFixed(3)} per decision`,
            usage: {
              decisions: {
                used: decisionCount,
                limit: limits.decisions,
                overage: decisionCount - limits.decisions + 1,
              },
              searches: {
                used: searchCount,
                limit: limits.searches,
                overage: Math.max(0, searchCount - limits.searches),
              },
            },
          },
          200,
        );
      }

      // Free tier — hard block
      const upgrade = PLAN_UPGRADE_NAMES[plan];
      return jsonResponse(
        {
          allowed: false,
          plan,
          reason:
            `Free tier limit reached (${decisionCount}/${limits.decisions} decisions).`,
          upgrade: {
            message: upgrade
              ? `Upgrade to ${upgrade.next} (${upgrade.price}) for ${PLAN_LIMITS[upgrade.next.toLowerCase()]?.decisions?.toLocaleString() ?? "more"} decisions.`
              : "Contact sales for Enterprise.",
            checkout_url: null,
          },
          usage: {
            decisions: { used: decisionCount, limit: limits.decisions },
            searches: { used: searchCount, limit: limits.searches },
          },
        },
        200,
      );
    }

    // 6. Check search limits
    if (operation === "search" && searchCount >= limits.searches) {
      if (limits.overage) {
        // Paid plan — track overage, allow operation
        try {
          await supabase.rpc("increment_usage_overage", {
            p_org_id: orgId,
            p_period_start: sub?.current_period_start ??
              new Date().toISOString(),
            p_period_end: sub?.current_period_end ?? new Date().toISOString(),
            p_field: "extra_searches",
            p_amount_cents: OVERAGE_RATES.search_cents,
          });
        } catch {
          // Overage tracking failure — never block the operation
        }

        return jsonResponse(
          {
            allowed: true,
            plan,
            overage: true,
            overage_rate: `$${(OVERAGE_RATES.search_cents / 100).toFixed(3)} per search`,
            usage: {
              decisions: {
                used: decisionCount,
                limit: limits.decisions,
                overage: Math.max(0, decisionCount - limits.decisions),
              },
              searches: {
                used: searchCount,
                limit: limits.searches,
                overage: searchCount - limits.searches + 1,
              },
            },
          },
          200,
        );
      }

      // Free tier — hard block
      const upgrade = PLAN_UPGRADE_NAMES[plan];
      return jsonResponse(
        {
          allowed: false,
          plan,
          reason:
            `Free tier limit reached (${searchCount}/${limits.searches} searches/day).`,
          upgrade: {
            message: upgrade
              ? `Upgrade to ${upgrade.next} (${upgrade.price}) for ${PLAN_LIMITS[upgrade.next.toLowerCase()]?.searches?.toLocaleString() ?? "more"} searches/day.`
              : "Contact sales for Enterprise.",
            checkout_url: null,
          },
          usage: {
            decisions: { used: decisionCount, limit: limits.decisions },
            searches: { used: searchCount, limit: limits.searches },
          },
        },
        200,
      );
    }

    // 7. T017: Track per-project usage for analytics (non-blocking)
    //    Limits are enforced at org level; project_id is tracked for
    //    per-project analytics (e.g., `teamind admin metrics --project`).
    if (projectId) {
      try {
        await supabase.rpc("track_project_usage", {
          p_org_id: orgId,
          p_project_id: projectId,
          p_operation: operation,
        });
      } catch {
        // Per-project tracking failure — never block the operation
      }
    }

    // 8. Within limits — allowed
    return jsonResponse(
      {
        allowed: true,
        plan,
        usage: {
          decisions: { used: decisionCount, limit: limits.decisions },
          searches: { used: searchCount, limit: limits.searches },
          members: { used: memberCount, limit: limits.members },
        },
      },
      200,
    );
  } catch (err) {
    console.error("check-usage error:", (err as Error).message);
    // Edge Function error — caller should fail-open
    return jsonResponse(
      { error: "internal_error", message: (err as Error).message },
      500,
    );
  }
});
