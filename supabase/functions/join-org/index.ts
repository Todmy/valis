import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MEMBER_LIMITS: Record<string, number> = {
  free: 3,
  pro: 50,
  enterprise: 500,
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { invite_code, author_name } = await req.json();

    if (!invite_code || typeof invite_code !== "string") {
      return new Response(JSON.stringify({ error: "invite_code_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!author_name || typeof author_name !== "string" || author_name.trim().length === 0) {
      return new Response(JSON.stringify({ error: "author_name_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Look up org by invite code
    const { data: org, error: orgError } = await supabase
      .from("orgs")
      .select("*")
      .eq("invite_code", invite_code.trim().toUpperCase())
      .single();

    if (orgError || !org) {
      return new Response(JSON.stringify({ error: "invalid_invite_code" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check member limit
    const { count: memberCount } = await supabase
      .from("members")
      .select("*", { count: "exact", head: true })
      .eq("org_id", org.id);

    const limit = MEMBER_LIMITS[org.plan] || 3;
    if ((memberCount || 0) >= limit) {
      return new Response(JSON.stringify({ error: "member_limit_reached" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if already a member
    const { data: existingMember } = await supabase
      .from("members")
      .select("id")
      .eq("org_id", org.id)
      .eq("author_name", author_name.trim())
      .single();

    if (existingMember) {
      return new Response(JSON.stringify({ error: "already_member" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert member
    const { error: insertError } = await supabase.from("members").insert({
      org_id: org.id,
      author_name: author_name.trim(),
      role: "member",
    });

    if (insertError) {
      return new Response(
        JSON.stringify({ error: "join_failed", message: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get decision count
    const { count: decisionCount } = await supabase
      .from("decisions")
      .select("*", { count: "exact", head: true })
      .eq("org_id", org.id);

    return new Response(
      JSON.stringify({
        org_id: org.id,
        org_name: org.name,
        api_key: org.api_key,
        member_count: (memberCount || 0) + 1,
        decision_count: decisionCount || 0,
        role: "member",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "join_failed", message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
