import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Plan limits: max members per org
// ---------------------------------------------------------------------------

const PLAN_MEMBER_LIMITS: Record<string, number> = {
  free: 5,
  team: 25,
  business: 50,
  enterprise: 500,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateMemberKey(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `tmm_${hex}`;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    // 1. Parse request body
    // ------------------------------------------------------------------
    const body = await req.json();
    const { invite_code, author_name } = body as {
      invite_code?: string;
      author_name?: string;
    };

    if (
      !invite_code ||
      typeof invite_code !== "string" ||
      invite_code.trim().length === 0
    ) {
      return jsonResponse({ error: "invite_code_required" }, 400);
    }

    if (
      !author_name ||
      typeof author_name !== "string" ||
      author_name.trim().length === 0
    ) {
      return jsonResponse({ error: "author_name_required" }, 400);
    }

    // ------------------------------------------------------------------
    // 2. DB setup
    // ------------------------------------------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ------------------------------------------------------------------
    // 3. Look up project by invite_code (case-insensitive)
    // ------------------------------------------------------------------
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, org_id, name, invite_code")
      .ilike("invite_code", invite_code.trim())
      .single();

    if (projectError || !project) {
      return jsonResponse({ error: "invalid_invite_code" }, 404);
    }

    const orgId = project.org_id;

    // ------------------------------------------------------------------
    // 4. Get org details
    // ------------------------------------------------------------------
    const { data: org, error: orgError } = await supabase
      .from("orgs")
      .select("id, name, api_key")
      .eq("id", orgId)
      .single();

    if (orgError || !org) {
      return jsonResponse({ error: "join_failed" }, 500);
    }

    // ------------------------------------------------------------------
    // 5. Check org member limit for plan
    // ------------------------------------------------------------------
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("plan")
      .eq("org_id", orgId)
      .eq("status", "active")
      .limit(1)
      .single();

    const plan = subscription?.plan ?? "free";
    const maxMembers = PLAN_MEMBER_LIMITS[plan] ?? 5;

    const { count: memberCount } = await supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("revoked_at", null);

    const currentMemberCount = memberCount ?? 0;

    // ------------------------------------------------------------------
    // 6. Check if author_name already exists as org member
    // ------------------------------------------------------------------
    const trimmedAuthor = author_name.trim();

    const { data: existingMember } = await supabase
      .from("members")
      .select("id, api_key, role")
      .eq("org_id", orgId)
      .eq("author_name", trimmedAuthor)
      .is("revoked_at", null)
      .single();

    let memberId: string;
    let memberKey: string | null;
    let isNewOrgMember = false;

    if (existingMember) {
      // Author already exists in org — reuse
      memberId = existingMember.id;
      memberKey = existingMember.api_key ?? null;

      // Check if already a project member
      const { data: existingProjectMember } = await supabase
        .from("project_members")
        .select("id")
        .eq("project_id", project.id)
        .eq("member_id", memberId)
        .single();

      if (existingProjectMember) {
        return jsonResponse({ error: "already_project_member" }, 409);
      }
    } else {
      // New org member — check limit
      if (currentMemberCount >= maxMembers) {
        return jsonResponse({ error: "member_limit_reached" }, 403);
      }

      // Create org member with per-member API key
      memberKey = generateMemberKey();

      const { data: newMember, error: newMemberError } = await supabase
        .from("members")
        .insert({
          org_id: orgId,
          author_name: trimmedAuthor,
          role: "member",
          api_key: memberKey,
        })
        .select("id")
        .single();

      if (newMemberError || !newMember) {
        console.error("join-project member insert error:", newMemberError?.message);
        return jsonResponse({ error: "join_failed" }, 500);
      }

      memberId = newMember.id;
      isNewOrgMember = true;
    }

    // ------------------------------------------------------------------
    // 7. Add to project_members as project_member
    // ------------------------------------------------------------------
    const { error: pmError } = await supabase.from("project_members").insert({
      project_id: project.id,
      member_id: memberId,
      role: "project_member",
    });

    if (pmError) {
      console.error("join-project project_members insert error:", pmError.message);
      return jsonResponse({ error: "join_failed" }, 500);
    }

    // ------------------------------------------------------------------
    // 8. Audit entries
    // ------------------------------------------------------------------
    const auditEntries: Array<Record<string, unknown>> = [];

    if (isNewOrgMember) {
      auditEntries.push({
        org_id: orgId,
        member_id: memberId,
        action: "member_joined",
        target_type: "member",
        target_id: memberId,
        previous_state: null,
        new_state: { author_name: trimmedAuthor, role: "member" },
        reason: `Joined via project invite code`,
      });
    }

    auditEntries.push({
      org_id: orgId,
      member_id: memberId,
      action: "project_member_added",
      target_type: "project",
      target_id: project.id,
      previous_state: null,
      new_state: {
        project_name: project.name,
        member_name: trimmedAuthor,
        role: "project_member",
      },
      reason: `Joined via invite code`,
    });

    if (auditEntries.length > 0) {
      await supabase.from("audit_entries").insert(auditEntries);
    }

    // ------------------------------------------------------------------
    // 9. Get project decision count
    // ------------------------------------------------------------------
    const { count: decisionCount } = await supabase
      .from("decisions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id);

    // ------------------------------------------------------------------
    // 10. Read public URLs from Deno env
    // ------------------------------------------------------------------
    const publicSupabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const publicQdrantUrl = Deno.env.get("QDRANT_URL") ?? "";

    // ------------------------------------------------------------------
    // 11. Return org + project metadata + credentials + public URLs
    // ------------------------------------------------------------------
    return jsonResponse(
      {
        org_id: orgId,
        org_name: org.name,
        project_id: project.id,
        project_name: project.name,
        member_api_key: memberKey,
        member_id: memberId,
        supabase_url: publicSupabaseUrl,
        qdrant_url: publicQdrantUrl,
        qdrant_api_key: Deno.env.get("QDRANT_API_KEY") || "",
        member_count: currentMemberCount + (isNewOrgMember ? 1 : 0),
        decision_count: decisionCount ?? 0,
        role: "project_member",
      },
      200,
    );
  } catch (err) {
    console.error("join-project error:", (err as Error).message);
    return jsonResponse({ error: "join_failed" }, 500);
  }
});
