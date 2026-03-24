import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Name validation: 1-100 chars, alphanumeric + spaces + hyphens.
 * Must start and end with alphanumeric. Single char is also valid.
 */
const NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9 \-]{0,98}[a-zA-Z0-9])?$/;

function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

function generateOrgApiKey(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `tm_${hex}`;
}

function generateMemberApiKey(): string {
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

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Extract client IP from request headers.
 * x-forwarded-for may contain comma-separated list; take the first.
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") ?? "unknown";
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
    // 1. Parse and validate request body
    // ------------------------------------------------------------------
    const body = await req.json();
    const { org_name, project_name, author_name } = body as {
      org_name?: string;
      project_name?: string;
      author_name?: string;
    };

    if (
      !org_name ||
      typeof org_name !== "string" ||
      org_name.trim().length === 0
    ) {
      return jsonResponse({ error: "org_name_required" }, 400);
    }

    if (
      !project_name ||
      typeof project_name !== "string" ||
      project_name.trim().length === 0
    ) {
      return jsonResponse({ error: "project_name_required" }, 400);
    }

    if (
      !author_name ||
      typeof author_name !== "string" ||
      author_name.trim().length === 0
    ) {
      return jsonResponse({ error: "author_name_required" }, 400);
    }

    const trimmedOrgName = org_name.trim();
    const trimmedProjectName = project_name.trim();
    const trimmedAuthorName = author_name.trim();

    if (!isValidName(trimmedOrgName)) {
      return jsonResponse({ error: "invalid_name", field: "org_name" }, 400);
    }

    if (!isValidName(trimmedProjectName)) {
      return jsonResponse(
        { error: "invalid_name", field: "project_name" },
        400,
      );
    }

    // Author name: 1-100 chars, trimmed (less restrictive — allow any printable)
    if (trimmedAuthorName.length < 1 || trimmedAuthorName.length > 100) {
      return jsonResponse(
        { error: "invalid_name", field: "author_name" },
        400,
      );
    }

    // ------------------------------------------------------------------
    // 2. DB setup (service_role — Edge Functions run server-side)
    // ------------------------------------------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ------------------------------------------------------------------
    // 3. Rate limit: max 10 registrations per IP per hour
    // ------------------------------------------------------------------
    const clientIp = getClientIp(req);

    const { count: rateLimitCount, error: rlError } = await supabase
      .from("registration_rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", clientIp)
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString());

    if (rlError) {
      console.error("Rate limit check error:", rlError.message);
      return jsonResponse({ error: "registration_failed" }, 500);
    }

    if ((rateLimitCount ?? 0) >= 10) {
      return jsonResponse({ error: "rate_limit_exceeded" }, 429);
    }

    // ------------------------------------------------------------------
    // 4. Check org name uniqueness (case-insensitive)
    // ------------------------------------------------------------------
    const { data: existingOrg } = await supabase
      .from("orgs")
      .select("id")
      .ilike("name", trimmedOrgName)
      .limit(1)
      .single();

    if (existingOrg) {
      return jsonResponse({ error: "org_name_taken" }, 409);
    }

    // ------------------------------------------------------------------
    // 5. Generate keys and IDs
    // ------------------------------------------------------------------
    const orgId = crypto.randomUUID();
    const orgApiKey = generateOrgApiKey();
    const orgInviteCode = generateInviteCode();
    const memberApiKey = generateMemberApiKey();
    const projectInviteCode = generateInviteCode();
    const projectId = crypto.randomUUID();

    // ------------------------------------------------------------------
    // 6. Atomic inserts with manual rollback on failure
    // ------------------------------------------------------------------

    // 6a. INSERT org
    const { error: orgError } = await supabase.from("orgs").insert({
      id: orgId,
      name: trimmedOrgName,
      api_key: orgApiKey,
      invite_code: orgInviteCode,
    });

    if (orgError) {
      console.error("register org insert error:", orgError.message);
      return jsonResponse({ error: "registration_failed" }, 500);
    }

    // 6b. INSERT member
    const { data: memberData, error: memberError } = await supabase
      .from("members")
      .insert({
        org_id: orgId,
        author_name: trimmedAuthorName,
        role: "admin",
        api_key: memberApiKey,
      })
      .select("id")
      .single();

    if (memberError || !memberData) {
      console.error("register member insert error:", memberError?.message);
      // Rollback: delete org
      await supabase.from("orgs").delete().eq("id", orgId);
      return jsonResponse({ error: "registration_failed" }, 500);
    }

    const memberId = memberData.id;

    // 6c. INSERT project
    const { error: projectError } = await supabase.from("projects").insert({
      id: projectId,
      org_id: orgId,
      name: trimmedProjectName,
      invite_code: projectInviteCode,
    });

    if (projectError) {
      console.error("register project insert error:", projectError.message);
      // Rollback: delete member, then org
      await supabase.from("members").delete().eq("id", memberId);
      await supabase.from("orgs").delete().eq("id", orgId);
      return jsonResponse({ error: "registration_failed" }, 500);
    }

    // 6d. INSERT project_member
    const { error: pmError } = await supabase.from("project_members").insert({
      project_id: projectId,
      member_id: memberId,
      role: "project_admin",
    });

    if (pmError) {
      console.error("register project_members insert error:", pmError.message);
      // Rollback: delete project, member, org
      await supabase.from("projects").delete().eq("id", projectId);
      await supabase.from("members").delete().eq("id", memberId);
      await supabase.from("orgs").delete().eq("id", orgId);
      return jsonResponse({ error: "registration_failed" }, 500);
    }

    // ------------------------------------------------------------------
    // 7. Audit entries (best-effort, don't fail registration)
    // ------------------------------------------------------------------
    try {
      await supabase.from("audit_entries").insert([
        {
          org_id: orgId,
          member_id: memberId,
          action: "org_created",
          target_type: "org",
          target_id: orgId,
          previous_state: null,
          new_state: { name: trimmedOrgName },
          reason: "Registration API",
        },
        {
          org_id: orgId,
          member_id: memberId,
          action: "member_joined",
          target_type: "member",
          target_id: memberId,
          previous_state: null,
          new_state: {
            author_name: trimmedAuthorName,
            role: "admin",
          },
          reason: "Registration API — founding member",
        },
        {
          org_id: orgId,
          member_id: memberId,
          action: "project_created",
          target_type: "project",
          target_id: projectId,
          previous_state: null,
          new_state: {
            name: trimmedProjectName,
            role: "project_admin",
          },
          reason: "Registration API — default project",
        },
      ]);
    } catch (auditErr) {
      console.error("register audit insert error:", (auditErr as Error).message);
      // Non-fatal: registration succeeded, audit logging failed
    }

    // ------------------------------------------------------------------
    // 8. Record rate limit entry
    // ------------------------------------------------------------------
    await supabase
      .from("registration_rate_limits")
      .insert({ ip_address: clientIp });

    // ------------------------------------------------------------------
    // 9. Return response — NO service_role key or org api_key
    // ------------------------------------------------------------------
    const publicSupabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const qdrantUrl = Deno.env.get("QDRANT_URL") ?? "";

    return jsonResponse(
      {
        member_api_key: memberApiKey,
        supabase_url: publicSupabaseUrl,
        qdrant_url: qdrantUrl,
        org_id: orgId,
        org_name: trimmedOrgName,
        project_id: projectId,
        project_name: trimmedProjectName,
        invite_code: orgInviteCode,
        member_id: memberId,
      },
      201,
    );
  } catch (err) {
    console.error("register error:", (err as Error).message);
    return jsonResponse({ error: "registration_failed" }, 500);
  }
});
