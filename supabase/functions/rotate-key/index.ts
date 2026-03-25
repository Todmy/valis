/**
 * @deprecated Migrated to Vercel API route: packages/web/src/app/api/rotate-key/route.ts
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
// Key generators (same logic as create-org)
// ---------------------------------------------------------------------------

function generateOrgApiKey(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `tm_${hex}`;
}

function generateMemberKey(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `tmm_${hex}`;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(len)))
      .map((b) => chars[b % chars.length])
      .join("");
  return `${part(4)}-${part(4)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function forbidden(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function notFound(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Extract Bearer token
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return unauthorized();
    }

    const apiKey = authHeader.slice(7).trim();
    if (!apiKey || apiKey.length < 4) {
      return unauthorized();
    }

    // 2. Parse body
    const { rotate, target_member_id, project_id } = await req.json();

    if (!rotate || !["api_key", "invite_code", "member_key", "project_invite_code"].includes(rotate)) {
      return badRequest("invalid_rotate_target");
    }

    if (rotate === "member_key" && !target_member_id) {
      return badRequest("invalid_rotate_target");
    }

    if (rotate === "project_invite_code" && !project_id) {
      return badRequest("invalid_rotate_target");
    }

    // 3. DB setup
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 4. Authenticate — resolve caller to a member + org
    let callerId: string;
    let callerOrgId: string;
    let callerRole: string;

    const isPerMemberKey = apiKey.startsWith("tmm_");
    const isOrgKey = apiKey.startsWith("tm_") && !isPerMemberKey;

    if (isPerMemberKey) {
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("id, org_id, role, api_key, revoked_at")
        .eq("api_key", apiKey)
        .is("revoked_at", null)
        .single();

      if (memberError || !member) return unauthorized();

      callerId = member.id;
      callerOrgId = member.org_id;
      callerRole = member.role;
    } else if (isOrgKey) {
      const { data: org, error: orgError } = await supabase
        .from("orgs")
        .select("id, api_key")
        .eq("api_key", apiKey)
        .single();

      if (orgError || !org) return unauthorized();

      // Resolve to first admin
      const { data: admin, error: adminError } = await supabase
        .from("members")
        .select("id, role")
        .eq("org_id", org.id)
        .eq("role", "admin")
        .is("revoked_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (adminError || !admin) return unauthorized();

      callerId = admin.id;
      callerOrgId = org.id;
      callerRole = admin.role;
    } else {
      return unauthorized();
    }

    // 5. Verify permissions
    //    - project_invite_code: project_admin or org admin (T016)
    //    - all others: org admin only
    if (rotate === "project_invite_code") {
      // Check if caller is org admin or project_admin for the target project
      if (callerRole !== "admin") {
        const { data: pm, error: pmError } = await supabase
          .from("project_members")
          .select("role")
          .eq("project_id", project_id)
          .eq("member_id", callerId)
          .single();

        if (pmError || !pm || pm.role !== "project_admin") {
          return forbidden("admin_required");
        }
      }
    } else if (callerRole !== "admin") {
      return forbidden("admin_required");
    }

    // 6. Perform rotation
    let newValue: string;
    let returnTargetMemberId: string | null = null;
    let auditAction: string;
    let auditTargetType: string;
    let auditTargetId: string;
    let previousState: Record<string, unknown> = {};

    if (rotate === "api_key") {
      // Rotate org-level API key
      const { data: org } = await supabase
        .from("orgs")
        .select("api_key")
        .eq("id", callerOrgId)
        .single();

      previousState = { api_key: org?.api_key ? `${org.api_key.substring(0, 6)}...` : null };
      newValue = generateOrgApiKey();

      const { error: updateError } = await supabase
        .from("orgs")
        .update({ api_key: newValue })
        .eq("id", callerOrgId);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: "rotation_failed", message: updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      auditAction = "org_key_rotated";
      auditTargetType = "org";
      auditTargetId = callerOrgId;
    } else if (rotate === "invite_code") {
      const { data: org } = await supabase
        .from("orgs")
        .select("invite_code")
        .eq("id", callerOrgId)
        .single();

      previousState = { invite_code: org?.invite_code ?? null };
      newValue = generateInviteCode();

      const { error: updateError } = await supabase
        .from("orgs")
        .update({ invite_code: newValue })
        .eq("id", callerOrgId);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: "rotation_failed", message: updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      auditAction = "key_rotated";
      auditTargetType = "org";
      auditTargetId = callerOrgId;
    } else if (rotate === "project_invite_code") {
      // T016: Rotate project invite code
      const { data: proj, error: projError } = await supabase
        .from("projects")
        .select("id, org_id, invite_code")
        .eq("id", project_id)
        .single();

      if (projError || !proj) {
        return notFound("project_not_found");
      }

      // Verify project belongs to caller's org
      if (proj.org_id !== callerOrgId) {
        return notFound("project_not_found");
      }

      previousState = { invite_code: proj.invite_code ?? null };
      newValue = generateInviteCode();

      const { error: updateError } = await supabase
        .from("projects")
        .update({ invite_code: newValue })
        .eq("id", project_id);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: "rotation_failed", message: updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      auditAction = "key_rotated";
      auditTargetType = "project";
      auditTargetId = project_id;
    } else {
      // rotate === "member_key"
      const { data: targetMember, error: targetError } = await supabase
        .from("members")
        .select("id, org_id, api_key")
        .eq("id", target_member_id)
        .eq("org_id", callerOrgId)
        .is("revoked_at", null)
        .single();

      if (targetError || !targetMember) {
        return notFound("member_not_found");
      }

      previousState = {
        api_key: targetMember.api_key
          ? `${targetMember.api_key.substring(0, 6)}...`
          : null,
      };
      newValue = generateMemberKey();
      returnTargetMemberId = target_member_id;

      const { error: updateError } = await supabase
        .from("members")
        .update({ api_key: newValue })
        .eq("id", target_member_id);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: "rotation_failed", message: updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      auditAction = "key_rotated";
      auditTargetType = "member";
      auditTargetId = target_member_id;
    }

    // 7. Create audit entry (T016: includes project_id for project rotations)
    await supabase.from("audit_log").insert({
      org_id: callerOrgId,
      member_id: callerId,
      action: auditAction,
      target_type: auditTargetType,
      target_id: auditTargetId,
      previous_state: previousState,
      new_state: { rotated: rotate },
      ...(rotate === "project_invite_code" && project_id
        ? { project_id }
        : {}),
    });

    // 8. Return
    return new Response(
      JSON.stringify({
        rotated: rotate,
        new_value: newValue,
        target_member_id: returnTargetMemberId,
        ...(rotate === "project_invite_code" && project_id
          ? { project_id }
          : {}),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("rotate-key error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: "rotation_failed", message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
