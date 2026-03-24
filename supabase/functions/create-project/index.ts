import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Plan limits: max projects per org
// ---------------------------------------------------------------------------

const PLAN_PROJECT_LIMITS: Record<string, number> = {
  free: 1,
  team: 10,
  business: 50,
  enterprise: Infinity,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(len)))
      .map((b) => chars[b % chars.length])
      .join("");
  return `${part(4)}-${part(4)}`;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function unauthorized(): Response {
  return jsonResponse({ error: "unauthorized" }, 401);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ------------------------------------------------------------------
    // 1. Extract Bearer token
    // ------------------------------------------------------------------
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return unauthorized();
    }
    const apiKey = authHeader.slice(7).trim();
    if (!apiKey || apiKey.length < 4) {
      return unauthorized();
    }

    // ------------------------------------------------------------------
    // 2. Parse request body
    // ------------------------------------------------------------------
    const body = await req.json();
    const { org_id, project_name } = body as {
      org_id?: string;
      project_name?: string;
    };

    if (
      !project_name ||
      typeof project_name !== "string" ||
      project_name.trim().length === 0
    ) {
      return jsonResponse({ error: "project_name_required" }, 400);
    }

    if (project_name.trim().length > 100) {
      return jsonResponse({ error: "project_name_too_long" }, 400);
    }

    if (!org_id || typeof org_id !== "string") {
      return jsonResponse({ error: "org_id_required" }, 400);
    }

    // ------------------------------------------------------------------
    // 3. DB setup
    // ------------------------------------------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ------------------------------------------------------------------
    // 4. Authenticate: resolve member from API key
    // ------------------------------------------------------------------
    const isPerMemberKey = apiKey.startsWith("tmm_");
    const isOrgKey = apiKey.startsWith("tm_") && !isPerMemberKey;

    if (!isPerMemberKey && !isOrgKey) {
      return unauthorized();
    }

    let memberId: string;
    let memberOrgId: string;

    if (isPerMemberKey) {
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("id, org_id, role, revoked_at")
        .eq("api_key", apiKey)
        .is("revoked_at", null)
        .single();

      if (memberError || !member) {
        return unauthorized();
      }
      memberId = member.id;
      memberOrgId = member.org_id;
    } else {
      // Org key: resolve org + first admin
      const { data: org, error: orgError } = await supabase
        .from("orgs")
        .select("id, api_key")
        .eq("api_key", apiKey)
        .single();

      if (orgError || !org) {
        return unauthorized();
      }

      const { data: admin, error: adminError } = await supabase
        .from("members")
        .select("id")
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
      memberOrgId = org.id;
    }

    // ------------------------------------------------------------------
    // 5. Verify member belongs to the specified org
    // ------------------------------------------------------------------
    if (memberOrgId !== org_id) {
      return jsonResponse({ error: "insufficient_permissions" }, 403);
    }

    // ------------------------------------------------------------------
    // 6. Check plan limits for max projects
    // ------------------------------------------------------------------
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("plan")
      .eq("org_id", org_id)
      .eq("status", "active")
      .limit(1)
      .single();

    const plan = subscription?.plan ?? "free";
    const maxProjects = PLAN_PROJECT_LIMITS[plan] ?? 1;

    const { count: projectCount } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org_id);

    if ((projectCount ?? 0) >= maxProjects) {
      return jsonResponse({ error: "plan_limit_reached" }, 403);
    }

    // ------------------------------------------------------------------
    // 7. Check project_name uniqueness within org
    // ------------------------------------------------------------------
    const trimmedName = project_name.trim();

    const { data: existingProject } = await supabase
      .from("projects")
      .select("id")
      .eq("org_id", org_id)
      .ilike("name", trimmedName)
      .limit(1)
      .single();

    if (existingProject) {
      return jsonResponse({ error: "project_name_exists" }, 409);
    }

    // ------------------------------------------------------------------
    // 8. Create project
    // ------------------------------------------------------------------
    const projectId = crypto.randomUUID();
    const inviteCode = generateInviteCode();

    const { error: insertError } = await supabase.from("projects").insert({
      id: projectId,
      org_id,
      name: trimmedName,
      invite_code: inviteCode,
    });

    if (insertError) {
      console.error("create-project insert error:", insertError.message);
      return jsonResponse({ error: "creation_failed" }, 500);
    }

    // ------------------------------------------------------------------
    // 9. Add creator as project_admin
    // ------------------------------------------------------------------
    const { error: memberInsertError } = await supabase
      .from("project_members")
      .insert({
        project_id: projectId,
        member_id: memberId,
        role: "project_admin",
      });

    if (memberInsertError) {
      // Rollback project on member insert failure
      await supabase.from("projects").delete().eq("id", projectId);
      console.error(
        "create-project member insert error:",
        memberInsertError.message,
      );
      return jsonResponse({ error: "creation_failed" }, 500);
    }

    // ------------------------------------------------------------------
    // 10. Audit entry
    // ------------------------------------------------------------------
    await supabase.from("audit_entries").insert({
      org_id,
      member_id: memberId,
      action: "project_created",
      target_type: "project",
      target_id: projectId,
      previous_state: null,
      new_state: { project_name: trimmedName, invite_code: inviteCode },
      reason: null,
    });

    // ------------------------------------------------------------------
    // 11. Return project metadata
    // ------------------------------------------------------------------
    return jsonResponse(
      {
        project_id: projectId,
        org_id,
        project_name: trimmedName,
        invite_code: inviteCode,
        role: "project_admin",
      },
      201,
    );
  } catch (err) {
    console.error("create-project error:", (err as Error).message);
    return jsonResponse({ error: "creation_failed" }, 500);
  }
});
