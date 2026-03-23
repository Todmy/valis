import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateApiKey(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `tm_${hex}`;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(len)))
      .map((b) => chars[b % chars.length])
      .join("");
  return `${part(4)}-${part(4)}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { name, author_name } = await req.json();

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return new Response(JSON.stringify({ error: "name_required" }), {
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

    const org_id = crypto.randomUUID();
    const api_key = generateApiKey();
    const invite_code = generateInviteCode();

    // Insert org
    const { error: orgError } = await supabase.from("orgs").insert({
      id: org_id,
      name: name.trim(),
      api_key,
      invite_code,
    });

    if (orgError) {
      return new Response(
        JSON.stringify({ error: "creation_failed", message: orgError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert admin member
    const { error: memberError } = await supabase.from("members").insert({
      org_id,
      author_name: author_name.trim(),
      role: "admin",
    });

    if (memberError) {
      // Rollback org on member failure
      await supabase.from("orgs").delete().eq("id", org_id);
      return new Response(
        JSON.stringify({ error: "creation_failed", message: memberError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        org_id,
        api_key,
        invite_code,
        author_name: author_name.trim(),
        role: "admin",
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "creation_failed", message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
