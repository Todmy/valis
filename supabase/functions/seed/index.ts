/**
 * @deprecated Migrated to Vercel API route: packages/web/src/app/api/seed/route.ts
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
// POST /functions/v1/seed
//
// Accepts an array of parsed decisions from the CLI and stores them
// server-side using service_role credentials. Authenticated via
// per-member API key (Bearer token).
//
// This enables hosted mode users to seed their brain without having
// service_role key on the client machine.
// ---------------------------------------------------------------------------

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Authenticate via Bearer token (per-member API key)
    // -----------------------------------------------------------------------
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token.length < 4) {
      return new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const qdrantUrl = Deno.env.get("QDRANT_URL") || "";
    const qdrantApiKey = Deno.env.get("QDRANT_API_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // -----------------------------------------------------------------------
    // 2. Resolve member from API key
    // -----------------------------------------------------------------------
    const isPerMember = token.startsWith("tmm_");
    let orgId: string;
    let memberId: string;
    let authorName: string;

    if (isPerMember) {
      const { data: member, error: memberErr } = await supabase
        .from("members")
        .select("id, org_id, author_name, revoked_at")
        .eq("api_key", token)
        .is("revoked_at", null)
        .single();

      if (memberErr || !member) {
        return new Response(
          JSON.stringify({ error: "unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      orgId = member.org_id;
      memberId = member.id;
      authorName = member.author_name;
    } else {
      // Legacy org-level key
      const { data: org, error: orgErr } = await supabase
        .from("orgs")
        .select("id")
        .eq("api_key", token)
        .single();

      if (orgErr || !org) {
        return new Response(
          JSON.stringify({ error: "unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: admin } = await supabase
        .from("members")
        .select("id, author_name")
        .eq("org_id", org.id)
        .eq("role", "admin")
        .order("joined_at", { ascending: true })
        .limit(1)
        .single();

      orgId = org.id;
      memberId = admin?.id || "unknown";
      authorName = admin?.author_name || "system";
    }

    // -----------------------------------------------------------------------
    // 3. Parse request body
    // -----------------------------------------------------------------------
    const body = await req.json();
    const { decisions, project_id } = body as {
      decisions: Array<{
        text: string;
        type?: string;
        summary?: string;
        affects?: string[];
      }>;
      project_id: string;
    };

    if (!Array.isArray(decisions) || !project_id) {
      return new Response(
        JSON.stringify({ error: "invalid_request", message: "decisions (array) and project_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // -----------------------------------------------------------------------
    // 3b. Verify member has access to the requested project
    // -----------------------------------------------------------------------
    const { data: projectAccess } = await supabase
      .from("project_members")
      .select("id")
      .eq("project_id", project_id)
      .eq("member_id", memberId)
      .limit(1)
      .maybeSingle();

    if (!projectAccess) {
      // Check if member is org admin (org admins have access to all projects)
      const { data: member } = await supabase
        .from("members")
        .select("role")
        .eq("id", memberId)
        .single();

      if (!member || member.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "no_project_access", message: "You do not have access to this project" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Limit: max 100 decisions per seed call
    const toProcess = decisions.slice(0, 100);

    // -----------------------------------------------------------------------
    // 4. Store decisions server-side
    // -----------------------------------------------------------------------
    let stored = 0;
    let skipped = 0;

    for (const d of toProcess) {
      if (!d.text || d.text.length < 10) {
        skipped++;
        continue;
      }

      // Generate content hash for dedup
      const normalized = d.text.trim().toLowerCase().replace(/\s+/g, " ");
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(normalized));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      const decisionId = crypto.randomUUID();
      const decisionType = d.type || "pending";
      const affects = d.affects || [];

      const { error: insertErr } = await supabase.from("decisions").insert({
        id: decisionId,
        org_id: orgId,
        project_id: project_id,
        type: decisionType,
        summary: d.summary || null,
        detail: d.text,
        status: "active",
        author: authorName,
        source: "seed",
        content_hash: hash,
        affects,
        pinned: false,
      });

      if (insertErr) {
        // Duplicate or other error — skip
        skipped++;
      } else {
        stored++;

        // Upsert to Qdrant for search indexing (best-effort)
        if (qdrantUrl && qdrantApiKey) {
          try {
            await fetch(`${qdrantUrl}/collections/decisions/points`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "api-key": qdrantApiKey,
              },
              body: JSON.stringify({
                points: [{
                  id: decisionId,
                  vector: new Array(384).fill(0), // zero vector — server-side embeddings generate actual
                  payload: {
                    org_id: orgId,
                    project_id: project_id,
                    type: decisionType,
                    summary: d.summary || "",
                    detail: d.text,
                    author: authorName,
                    source: "seed",
                    affects,
                    status: "active",
                    pinned: false,
                    confidence: null,
                    created_at: new Date().toISOString(),
                  },
                }],
              }),
            });
          } catch {
            // Qdrant failure non-critical during seed
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // 5. Return result
    // -----------------------------------------------------------------------
    return new Response(
      JSON.stringify({
        stored,
        skipped,
        total: toProcess.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "seed_failed", message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
