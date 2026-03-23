import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  if (aBuf.byteLength !== bBuf.byteLength) {
    // Compare against self to keep constant time, then return false.
    crypto.subtle.timingSafeEqual(aBuf, aBuf);
    return false;
  }

  return crypto.subtle.timingSafeEqual(aBuf, bBuf);
}

/** Valid status transitions: map of old_status -> allowed new_status values */
const VALID_TRANSITIONS: Record<string, string[]> = {
  proposed: ["active"],
  active: ["deprecated", "superseded"],
};

/** Audit action names keyed by the new status */
const AUDIT_ACTIONS: Record<string, string> = {
  active: "decision_promoted",
  deprecated: "decision_deprecated",
  superseded: "decision_superseded",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function unauthorized(): Response {
  return jsonResponse({ error: "unauthorized" }, 401);
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ------------------------------------------------------------------
    // 1. Authenticate via Bearer token (same pattern as exchange-token)
    // ------------------------------------------------------------------
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return unauthorized();
    }

    const apiKey = authHeader.slice(7).trim();
    if (!apiKey || apiKey.length < 4) {
      return unauthorized();
    }

    const isPerMemberKey = apiKey.startsWith("tmm_");
    const isOrgKey = apiKey.startsWith("tm_") && !isPerMemberKey;

    if (!isPerMemberKey && !isOrgKey) {
      return unauthorized();
    }

    // ------------------------------------------------------------------
    // 2. DB setup (service_role - trusted server-side code)
    // ------------------------------------------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let memberId: string;
    let orgId: string;
    let memberRole: string;
    let authorName: string;

    if (isPerMemberKey) {
      // Per-member key: look up member + org
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("id, org_id, author_name, role, api_key, revoked_at")
        .eq("api_key", apiKey)
        .is("revoked_at", null)
        .single();

      if (memberError || !member) {
        return unauthorized();
      }

      if (!timingSafeEqual(member.api_key, apiKey)) {
        return unauthorized();
      }

      memberId = member.id;
      orgId = member.org_id;
      memberRole = member.role;
      authorName = member.author_name;
    } else {
      // Org-level key: look up org, then first admin member
      const { data: org, error: orgError } = await supabase
        .from("orgs")
        .select("id, name, api_key")
        .eq("api_key", apiKey)
        .single();

      if (orgError || !org) {
        return unauthorized();
      }

      if (!timingSafeEqual(org.api_key, apiKey)) {
        return unauthorized();
      }

      const { data: admin, error: adminError } = await supabase
        .from("members")
        .select("id, author_name, role")
        .eq("org_id", org.id)
        .eq("role", "admin")
        .is("revoked_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (adminError || !admin) {
        return unauthorized();
      }

      memberId = admin.id;
      orgId = org.id;
      memberRole = admin.role;
      authorName = admin.author_name;
    }

    // ------------------------------------------------------------------
    // 3. Parse and validate request body
    // ------------------------------------------------------------------
    const { decision_id, new_status, reason } = await req.json();

    if (!decision_id || typeof decision_id !== "string") {
      return jsonResponse({ error: "invalid_transition" }, 400);
    }

    if (
      !new_status ||
      !["active", "deprecated", "superseded"].includes(new_status)
    ) {
      return jsonResponse({ error: "invalid_transition" }, 400);
    }

    // ------------------------------------------------------------------
    // 4. Load decision by ID, verify same org
    // ------------------------------------------------------------------
    const { data: decision, error: decisionError } = await supabase
      .from("decisions")
      .select("id, org_id, status, author_name")
      .eq("id", decision_id)
      .single();

    if (decisionError || !decision) {
      return jsonResponse({ error: "decision_not_found" }, 404);
    }

    if (decision.org_id !== orgId) {
      return jsonResponse({ error: "decision_not_found" }, 404);
    }

    // ------------------------------------------------------------------
    // 5. Validate transition
    // ------------------------------------------------------------------
    const oldStatus: string = decision.status;
    const allowedTransitions = VALID_TRANSITIONS[oldStatus];

    if (!allowedTransitions || !allowedTransitions.includes(new_status)) {
      return jsonResponse({ error: "invalid_transition" }, 400);
    }

    // ------------------------------------------------------------------
    // 6. Permission check: active -> superseded requires admin or original author
    // ------------------------------------------------------------------
    if (new_status === "superseded") {
      const isAdmin = memberRole === "admin";
      const isOriginalAuthor = authorName === decision.author_name;
      if (!isAdmin && !isOriginalAuthor) {
        return jsonResponse({ error: "insufficient_permissions" }, 403);
      }
    }

    // ------------------------------------------------------------------
    // 7. UPDATE decision status
    // ------------------------------------------------------------------
    const { error: updateError } = await supabase
      .from("decisions")
      .update({
        status: new_status,
        status_changed_by: authorName,
        status_changed_at: new Date().toISOString(),
        status_reason: reason || null,
      })
      .eq("id", decision_id);

    if (updateError) {
      return jsonResponse(
        { error: "update_failed", message: updateError.message },
        500,
      );
    }

    // ------------------------------------------------------------------
    // 8. If deprecated: find dependents
    // ------------------------------------------------------------------
    let flaggedDependents: string[] = [];

    if (new_status === "deprecated") {
      const { data: dependents } = await supabase
        .from("decisions")
        .select("id")
        .eq("org_id", orgId)
        .contains("depends_on", [decision_id]);

      if (dependents && dependents.length > 0) {
        flaggedDependents = dependents.map(
          (d: { id: string }) => d.id,
        );
      }
    }

    // ------------------------------------------------------------------
    // 9. Resolve open contradictions involving this decision
    // ------------------------------------------------------------------
    if (new_status === "deprecated" || new_status === "superseded") {
      await supabase
        .from("contradictions")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: memberId,
        })
        .or(
          `decision_a_id.eq.${decision_id},decision_b_id.eq.${decision_id}`,
        )
        .eq("status", "open");
    }

    // ------------------------------------------------------------------
    // 10. Create audit entry
    // ------------------------------------------------------------------
    const auditAction = AUDIT_ACTIONS[new_status];

    await supabase.from("audit_entries").insert({
      org_id: orgId,
      member_id: memberId,
      action: auditAction,
      target_type: "decision",
      target_id: decision_id,
      previous_state: { status: oldStatus },
      new_state: { status: new_status },
      reason: reason || null,
    });

    // ------------------------------------------------------------------
    // 11. Return result
    // ------------------------------------------------------------------
    return jsonResponse(
      {
        decision_id,
        old_status: oldStatus,
        new_status,
        changed_by: authorName,
        flagged_dependents: flaggedDependents,
      },
      200,
    );
  } catch (err) {
    console.error("change-status error:", (err as Error).message);
    return jsonResponse(
      { error: "update_failed", message: (err as Error).message },
      500,
    );
  }
});
