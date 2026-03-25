/**
 * T032: POST /api/enrich — Server-side LLM enrichment for hosted users.
 *
 * Authenticates via Bearer JWT, accepts up to 20 decision IDs, calls the
 * Anthropic API to classify each unenriched decision, updates Postgres and
 * Qdrant, and enforces a daily enrichment budget per org.
 *
 * Community users are rejected (403) — they use `teamind enrich` locally.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import {
  jsonResponse,
  unauthorized,
  forbidden,
  badRequest,
} from '@/lib/api-response';
import { extractBearerToken } from '@/lib/api-auth';
import { jwtVerify } from 'jose';
import { enrichDecision } from '@/lib/anthropic';
import { updateDecisionPayload } from '@/lib/qdrant-server';

export const dynamic = 'force-dynamic';

/** Maximum decisions per single API call. */
const MAX_DECISIONS_PER_CALL = 20;

/** Default daily enrichment budget in cents ($1.00). */
const DEFAULT_DAILY_BUDGET_CENTS = 100;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Check Anthropic API key availability
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return jsonResponse(
      {
        error: 'enrichment_unavailable',
        message: 'ANTHROPIC_API_KEY not configured',
      },
      503,
    );
  }

  // 2. Authenticate via Bearer JWT
  const token = extractBearerToken(request);
  if (!token) {
    return unauthorized('unauthorized');
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return jsonResponse(
      { error: 'server_misconfigured', message: 'JWT_SECRET not configured' },
      500,
    );
  }

  let claims: Record<string, unknown>;
  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret, { issuer: 'teamind' });
    claims = payload as Record<string, unknown>;
  } catch {
    return unauthorized('unauthorized');
  }

  const orgId = claims.org_id as string | undefined;
  const projectId = claims.project_id as string | undefined;
  const memberId = claims.sub as string | undefined;

  if (!orgId || !memberId) {
    return unauthorized('unauthorized');
  }

  // 3. Reject community users
  // Community users should use `teamind enrich` locally with their own API key.
  // On the hosted server, ANTHROPIC_API_KEY is set (checked in step 1).
  // If a community user somehow reaches this endpoint, we detect it via the
  // JWT `hosted` claim. Community-mode JWTs lack this claim.
  const isHosted = claims.hosted === true;
  if (!isHosted) {
    return forbidden('community_users_use_local_enrich');
  }

  // 4. Parse request body
  let body: { decision_ids?: unknown };
  try {
    body = (await request.json()) as { decision_ids?: unknown };
  } catch {
    return badRequest('decision_ids_required');
  }

  const decisionIds = body.decision_ids;
  if (!Array.isArray(decisionIds) || decisionIds.length === 0) {
    return badRequest('decision_ids_required');
  }

  if (decisionIds.length > MAX_DECISIONS_PER_CALL) {
    return badRequest(
      `max_${MAX_DECISIONS_PER_CALL}_decisions_per_call`,
    );
  }

  // Validate all IDs are strings
  const validIds = decisionIds.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (validIds.length === 0) {
    return badRequest('decision_ids_required');
  }

  const supabase = createServerClient();

  // 5. Check daily enrichment budget
  const dailyBudgetCents =
    Number(process.env.ENRICHMENT_DAILY_BUDGET_CENTS) || DEFAULT_DAILY_BUDGET_CENTS;

  const todayStr = new Date().toISOString().split('T')[0];

  const { data: usageRows } = await supabase
    .from('enrichment_usage')
    .select('cost_cents')
    .eq('org_id', orgId)
    .eq('date', todayStr);

  const spentToday = (usageRows ?? []).reduce(
    (sum, row) => sum + ((row.cost_cents as number) ?? 0),
    0,
  );

  if (spentToday >= dailyBudgetCents) {
    return jsonResponse({ error: 'daily_enrichment_budget_exceeded' }, 429);
  }

  // 6. Fetch requested decisions from Postgres
  let query = supabase
    .from('decisions')
    .select('*')
    .eq('org_id', orgId)
    .in('id', validIds);

  if (projectId) {
    query = query.eq('project_id', projectId);
  }

  const { data: decisions, error: fetchError } = await query;

  if (fetchError) {
    return jsonResponse(
      { error: 'fetch_failed', message: fetchError.message },
      500,
    );
  }

  if (!decisions || decisions.length === 0) {
    return jsonResponse(
      {
        enriched: [],
        skipped: validIds,
        total_cost_cents: 0,
        daily_budget_remaining_cents: Math.max(0, dailyBudgetCents - spentToday),
      },
      200,
    );
  }

  // 7. Separate already-enriched from unenriched decisions
  const alreadyEnriched: string[] = [];
  const toEnrich: typeof decisions = [];

  for (const decision of decisions) {
    if (decision.enriched_by) {
      alreadyEnriched.push(decision.id);
    } else {
      toEnrich.push(decision);
    }
  }

  // IDs not found in the database are also "skipped"
  const foundIds = new Set(decisions.map((d) => d.id));
  const notFound = validIds.filter((id) => !foundIds.has(id));
  const skipped = [...alreadyEnriched, ...notFound];

  // 8. Enrich each unenriched decision
  const enrichedResults: Array<{
    decision_id: string;
    type: string;
    summary: string;
    affects: string[];
    confidence: number;
    tokens_used: number;
    cost_cents: number;
  }> = [];

  let totalCostCents = 0;
  let runningBudget = dailyBudgetCents - spentToday;

  for (const decision of toEnrich) {
    // Re-check budget before each enrichment
    if (runningBudget <= 0) {
      skipped.push(decision.id);
      continue;
    }

    try {
      const result = await enrichDecision(decision.detail, anthropicKey);

      // Update Postgres
      const { error: updateError } = await supabase
        .from('decisions')
        .update({
          type: result.type,
          summary: result.summary,
          affects: result.affects,
          confidence: result.confidence,
          enriched_by: 'llm',
        })
        .eq('id', decision.id)
        .eq('org_id', orgId);

      if (updateError) {
        console.error(
          `[enrich] Postgres update failed for ${decision.id}: ${updateError.message}`,
        );
        skipped.push(decision.id);
        continue;
      }

      // Update Qdrant (non-fatal)
      try {
        await updateDecisionPayload(decision.id, orgId, {
          type: result.type,
          summary: result.summary,
          affects: result.affects,
          confidence: result.confidence,
        });
      } catch (qdrantErr) {
        console.warn(
          `[enrich] Qdrant update failed for ${decision.id}: ${(qdrantErr as Error).message}`,
        );
      }

      // Log to enrichment_usage
      await supabase.rpc('increment_enrichment_usage', {
        p_org_id: orgId,
        p_date: todayStr,
        p_provider: 'anthropic',
        p_decisions: 1,
        p_tokens: result.tokens_used,
        p_cost_cents: result.cost_cents,
      });

      totalCostCents += result.cost_cents;
      runningBudget -= result.cost_cents;

      enrichedResults.push({
        decision_id: decision.id,
        type: result.type,
        summary: result.summary,
        affects: result.affects,
        confidence: result.confidence,
        tokens_used: result.tokens_used,
        cost_cents: result.cost_cents,
      });
    } catch (err) {
      console.error(
        `[enrich] Enrichment failed for ${decision.id}: ${(err as Error).message}`,
      );
      skipped.push(decision.id);
    }
  }

  return jsonResponse(
    {
      enriched: enrichedResults,
      skipped,
      total_cost_cents: totalCostCents,
      daily_budget_remaining_cents: Math.max(0, runningBudget),
    },
    200,
  );
}
