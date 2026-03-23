import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "https://deno.land/x/jose@v5.2.0/index.ts";

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

/** Generic unauthorized response — never leaks key type or lookup details. */
function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  // CORS preflight
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
    // 2. Determine key type — tmm_ = per-member, tm_ = org-level
    //    (we never expose the distinction in error responses)
    // ------------------------------------------------------------------
    const isPerMemberKey = apiKey.startsWith("tmm_");
    const isOrgKey = apiKey.startsWith("tm_") && !isPerMemberKey;

    if (!isPerMemberKey && !isOrgKey) {
      return unauthorized();
    }

    // ------------------------------------------------------------------
    // 3. DB setup (service_role — trusted server-side code)
    // ------------------------------------------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const jwtSecret = Deno.env.get("JWT_SECRET");

    if (!jwtSecret) {
      console.error("JWT_SECRET env var is not configured");
      return new Response(
        JSON.stringify({ error: "token_generation_failed" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let memberId: string;
    let orgId: string;
    let orgName: string;
    let memberRole: string;
    let authorName: string;

    if (isPerMemberKey) {
      // ----------------------------------------------------------------
      // 3a. Per-member key: look up member + org
      // ----------------------------------------------------------------
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("id, org_id, author_name, role, api_key, revoked_at")
        .eq("api_key", apiKey)
        .is("revoked_at", null)
        .single();

      if (memberError || !member) {
        return unauthorized();
      }

      // Timing-safe comparison of the stored key vs provided key
      if (!timingSafeEqual(member.api_key, apiKey)) {
        return unauthorized();
      }

      // Fetch org details
      const { data: org, error: orgError } = await supabase
        .from("orgs")
        .select("id, name")
        .eq("id", member.org_id)
        .single();

      if (orgError || !org) {
        return unauthorized();
      }

      memberId = member.id;
      orgId = org.id;
      orgName = org.name;
      memberRole = member.role;
      authorName = member.author_name;
    } else {
      // ----------------------------------------------------------------
      // 3b. Org-level key: look up org, then first admin member
      // ----------------------------------------------------------------
      const { data: org, error: orgError } = await supabase
        .from("orgs")
        .select("id, name, api_key")
        .eq("api_key", apiKey)
        .single();

      if (orgError || !org) {
        return unauthorized();
      }

      // Timing-safe comparison of the stored key vs provided key
      if (!timingSafeEqual(org.api_key, apiKey)) {
        return unauthorized();
      }

      // Resolve to first admin member for attribution
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
      orgName = org.name;
      memberRole = admin.role;
      authorName = admin.author_name;
    }

    // ------------------------------------------------------------------
    // 4. Mint JWT (HS256, 1h TTL)
    // ------------------------------------------------------------------
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600; // 1 hour

    const secret = new TextEncoder().encode(jwtSecret);

    const token = await new SignJWT({
      sub: memberId,
      role: "authenticated",
      iss: "teamind",
      org_id: orgId,
      member_role: memberRole,
      author_name: authorName,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(secret);

    // ------------------------------------------------------------------
    // 5. Return response per contract
    // ------------------------------------------------------------------
    const expiresAt = new Date(exp * 1000).toISOString();

    return new Response(
      JSON.stringify({
        token,
        expires_at: expiresAt,
        member_id: memberId,
        org_id: orgId,
        org_name: orgName,
        role: memberRole,
        author_name: authorName,
        auth_mode: "jwt",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("exchange-token error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: "token_generation_failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
