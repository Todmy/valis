import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "https://deno.land/x/jose@v5.2.0/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Extract Bearer token from Authorization header
    const authHeader = req.headers.get("authorization") ?? "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    const apiKey = match[1];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const jwtSecret = Deno.env.get("JWT_SECRET");

    if (!jwtSecret) {
      return jsonResponse({ error: "token_generation_failed" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let memberId: string;
    let orgId: string;
    let orgName: string;
    let memberRole: string;
    let authorName: string;

    // 2. Look up by prefix: tmm_ = per-member key, tm_ = legacy org key
    if (apiKey.startsWith("tmm_")) {
      // Per-member key lookup
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("id, org_id, role, author_name, revoked_at")
        .eq("api_key", apiKey)
        .single();

      if (memberError || !member) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      // 3. Check revoked_at IS NULL
      if (member.revoked_at !== null) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      // Fetch org name
      const { data: org, error: orgError } = await supabase
        .from("orgs")
        .select("name")
        .eq("id", member.org_id)
        .single();

      if (orgError || !org) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      memberId = member.id;
      orgId = member.org_id;
      orgName = org.name;
      memberRole = member.role;
      authorName = member.author_name;
    } else if (apiKey.startsWith("tm_")) {
      // Legacy org-level key lookup
      const { data: org, error: orgError } = await supabase
        .from("orgs")
        .select("id, name")
        .eq("api_key", apiKey)
        .single();

      if (orgError || !org) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      // 4. Find first admin member for attribution
      const { data: adminMember, error: adminError } = await supabase
        .from("members")
        .select("id, role, author_name")
        .eq("org_id", org.id)
        .eq("role", "admin")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (adminError || !adminMember) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      memberId = adminMember.id;
      orgId = org.id;
      orgName = org.name;
      memberRole = adminMember.role;
      authorName = adminMember.author_name;
    } else {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    // 5. Mint JWT (HS256, 1h expiry)
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600;
    const secret = new TextEncoder().encode(jwtSecret);

    let token: string;
    try {
      token = await new SignJWT({
        sub: memberId,
        role: "authenticated",
        org_id: orgId,
        member_role: memberRole,
        author_name: authorName,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(now)
        .setExpirationTime(exp)
        .setIssuer("teamind")
        .sign(secret);
    } catch (_err) {
      return jsonResponse({ error: "token_generation_failed" }, 500);
    }

    // 6. Return token + metadata
    return jsonResponse(
      {
        token,
        expires_at: new Date(exp * 1000).toISOString(),
        member_id: memberId,
        org_id: orgId,
        org_name: orgName,
        role: memberRole,
        author_name: authorName,
        auth_mode: "jwt",
      },
      200,
    );
  } catch (_err) {
    return jsonResponse({ error: "token_generation_failed" }, 500);
  }
});
