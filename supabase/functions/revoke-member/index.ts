/**
 * @deprecated Migrated to Vercel API route: packages/web/src/app/api/revoke-member/route.ts
 * This Edge Function is kept for community/self-hosted deployments only.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

function notFound(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
    const body = await req.json();
    const targetMemberId: string | undefined = body.member_id;
    const force: boolean = body.force === true;

    if (!targetMemberId || typeof targetMemberId !== "string") {
      return new Response(
        JSON.stringify({ error: "member_id_required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. DB setup
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 4. Authenticate caller
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

    // 5. Verify admin
    if (callerRole !== "admin") {
      return forbidden("admin_required");
    }

    // 6. Self-revocation guard
    if (targetMemberId === callerId && !force) {
      return new Response(
        JSON.stringify({
          error: "self_revoke_warning",
          message:
            "You are about to revoke your own access. Pass force: true to confirm.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 7. Look up target member
    const { data: target, error: targetError } = await supabase
      .from("members")
      .select("id, org_id, author_name, revoked_at")
      .eq("id", targetMemberId)
      .eq("org_id", callerOrgId)
      .single();

    if (targetError || !target) {
      return notFound("member_not_found");
    }

    if (target.revoked_at) {
      return new Response(
        JSON.stringify({ error: "already_revoked" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 8. Revoke
    const { error: updateError } = await supabase
      .from("members")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", targetMemberId);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "revoke_failed", message: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 9. Audit entry
    await supabase.from("audit_log").insert({
      org_id: callerOrgId,
      member_id: callerId,
      action: "member_revoked",
      target_type: "member",
      target_id: targetMemberId,
      previous_state: { revoked_at: null },
      new_state: { revoked_at: new Date().toISOString() },
    });

    // 10. Return
    return new Response(
      JSON.stringify({
        revoked: true,
        member_id: targetMemberId,
        author_name: target.author_name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("revoke-member error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: "revoke_failed", message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
