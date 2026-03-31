/**
 * 009: POST /api/enforce — CI Enforcement endpoint.
 *
 * Accepts a PR diff + changed file list, searches for relevant active
 * constraint/pattern decisions, sends to Claude Haiku for violation
 * analysis, and returns structured violations.
 *
 * Auth: Bearer API key (tmm_/tm_) or JWT.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import {
  jsonResponse,
  unauthorized,
  badRequest,
  serverError,
} from '@/lib/api-response';
import { extractBearerToken, authenticateApiKey } from '@/lib/api-auth';
import { jwtVerify, SignJWT } from 'jose';

export const dynamic = 'force-dynamic';

// Max diff size to send to Haiku (characters). Truncate beyond this.
const MAX_DIFF_SIZE = 60_000;
const COLLECTION_NAME = 'decisions';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Violation {
  decision_id: string;
  decision_summary: string;
  decision_type: string;
  file: string;
  line: number | null;
  explanation: string;
}

interface EnforceResponse {
  pass: boolean;
  violations: Violation[];
  decisions_checked: number;
  files_checked: number;
  areas_searched: string[];
}

interface DecisionHit {
  id: string;
  type: string;
  summary: string | null;
  detail: string;
  affects: string[];
  status: string;
}

// ---------------------------------------------------------------------------
// Area inference from file paths
// ---------------------------------------------------------------------------

const PATH_AREA_MAP: [RegExp, string[]][] = [
  [/\bauth\b/i, ['auth']],
  [/\bapi\b/i, ['api', 'api-design']],
  [/\bdatabase\b|\bdb\b|\bmigration/i, ['database']],
  [/\bmcp\b/i, ['mcp']],
  [/\bsupabase\b/i, ['database', 'supabase']],
  [/\.test\.|\.spec\.|__tests__/i, ['testing']],
  [/\bdashboard\b|\bweb\b/i, ['dashboard', 'web']],
  [/\bcli\b/i, ['cli']],
  [/\bbilling\b|\bstripe\b|\bpayment/i, ['billing']],
  [/\bsearch\b|\bqdrant\b/i, ['search']],
];

function inferAreas(files: string[]): string[] {
  const areas = new Set<string>();

  for (const file of files) {
    // Match known path patterns
    for (const [pattern, tags] of PATH_AREA_MAP) {
      if (pattern.test(file)) {
        for (const tag of tags) areas.add(tag);
      }
    }

    // Extract directory names as tags (e.g., src/billing/stripe.ts → billing, stripe)
    const segments = file.replace(/\\/g, '/').split('/');
    // Skip file name (last segment) and common generic dirs
    const skipDirs = new Set(['src', 'lib', 'app', 'packages', 'node_modules', 'dist', '.']);
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i].toLowerCase();
      if (seg && !skipDirs.has(seg) && seg.length > 1) {
        areas.add(seg);
      }
    }
  }

  return [...areas];
}

// ---------------------------------------------------------------------------
// Qdrant search (reuses pattern from /api/search)
// ---------------------------------------------------------------------------

function qdrantHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['api-key'] = apiKey;
  return headers;
}

async function searchDecisions(
  qdrantUrl: string,
  qdrantApiKey: string | undefined,
  orgId: string,
  projectId: string | undefined,
  areas: string[],
): Promise<DecisionHit[]> {
  // Build search query from areas
  const query = areas.join(' ');
  if (!query) return [];

  // Filter: org + project + active status + constraint/pattern types
  const mustClauses: Record<string, unknown>[] = [
    { key: 'org_id', match: { value: orgId } },
    { key: 'status', match: { value: 'active' } },
    {
      should: [
        { key: 'type', match: { value: 'constraint' } },
        { key: 'type', match: { value: 'pattern' } },
      ],
    },
  ];

  if (projectId) {
    mustClauses.push({
      should: [
        { key: 'project_id', match: { value: projectId } },
        { is_null: { key: 'project_id' } },
      ],
    });
  }

  const filter = { must: mustClauses };

  // Semantic search via Qdrant query endpoint (server-side embeddings)
  const url = `${qdrantUrl}/collections/${COLLECTION_NAME}/points/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: qdrantHeaders(qdrantApiKey),
    body: JSON.stringify({
      query,
      filter,
      limit: 30,
      with_payload: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Qdrant search failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    result: { points: Array<{ id: string; payload?: Record<string, unknown> }> };
  };

  return data.result.points
    .map((p) => {
      const payload = p.payload ?? {};
      return {
        id: p.id as string,
        type: (payload.type as string) ?? 'pending',
        summary: (payload.summary as string) || null,
        detail: (payload.detail as string) ?? '',
        affects: (payload.affects as string[]) || [],
        status: (payload.status as string) || 'active',
      };
    })
    .filter((d) => d.status === 'active');
}

// ---------------------------------------------------------------------------
// Claude Haiku violation analysis
// ---------------------------------------------------------------------------

async function analyzeViolations(
  anthropicApiKey: string,
  decisions: DecisionHit[],
  diff: string,
  files: string[],
): Promise<Violation[]> {
  const decisionsText = decisions
    .map(
      (d, i) =>
        `[${i + 1}] ID: ${d.id}\n    Type: ${d.type}\n    Summary: ${d.summary ?? '(none)'}\n    Detail: ${d.detail}\n    Affects: ${d.affects.join(', ')}`,
    )
    .join('\n\n');

  const truncatedDiff =
    diff.length > MAX_DIFF_SIZE
      ? diff.slice(0, MAX_DIFF_SIZE) + '\n\n... [diff truncated]'
      : diff;

  const systemPrompt = `You are a strict code reviewer. You check whether a PR diff violates team architectural decisions.

For each violation found, return a JSON object with:
- decision_id: the ID of the violated decision (from the list provided)
- file: the file where the violation occurs
- line: approximate line number from diff hunk headers, or null if unclear
- explanation: one sentence explaining the violation

IMPORTANT:
- Only flag clear, unambiguous violations. Do not flag stylistic preferences or uncertain cases.
- When in doubt, do NOT flag.
- Only check against the provided decisions. Do not invent new rules.
- Return ONLY a JSON array. No markdown fences, no explanations outside the array.
- If no violations found, return: []`;

  const userPrompt = `## Team Decisions (constraints and patterns to enforce)

${decisionsText}

## Changed Files
${files.join('\n')}

## PR Diff
\`\`\`diff
${truncatedDiff}
\`\`\`

Analyze the diff against the team decisions above. Return a JSON array of violations.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const textBlock = data.content.find((c) => c.type === 'text');
  if (!textBlock?.text) return [];

  // Parse JSON from response (handle potential markdown fences)
  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonText) as Array<{
    decision_id?: string;
    file?: string;
    line?: number | null;
    explanation?: string;
  }>;

  if (!Array.isArray(parsed)) return [];

  // Build a lookup for decision summaries/types
  const decisionMap = new Map(decisions.map((d) => [d.id, d]));

  return parsed
    .filter((v) => v.decision_id && v.explanation)
    .map((v) => {
      const decision = decisionMap.get(v.decision_id!);
      return {
        decision_id: v.decision_id!,
        decision_summary: decision?.summary ?? '',
        decision_type: decision?.type ?? 'unknown',
        file: v.file ?? '',
        line: v.line ?? null,
        explanation: v.explanation!,
      };
    });
}

// ---------------------------------------------------------------------------
// Auth: resolve bearer token to org_id + project_id
// ---------------------------------------------------------------------------

interface AuthClaims {
  orgId: string;
  memberId: string;
  projectId?: string;
}

async function resolveAuth(
  token: string,
  jwtSecret: string,
): Promise<AuthClaims | null> {
  // Try JWT first
  try {
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret, { issuer: 'valis' });
    const orgId = payload.org_id as string | undefined;
    const memberId = payload.sub as string | undefined;
    const projectId = payload.project_id as string | undefined;
    if (orgId && memberId) return { orgId, memberId, projectId };
  } catch {
    // Not a valid JWT — try as API key
  }

  // Try API key → mint short-lived JWT internally
  if (token.startsWith('tmm_') || token.startsWith('tm_')) {
    const supabase = createServerClient();
    const auth = await authenticateApiKey(supabase, token);
    if (!auth) return null;
    return { orgId: auth.orgId, memberId: auth.memberId };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Check required env vars
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY;
  const jwtSecret = process.env.JWT_SECRET;

  if (!qdrantUrl || !jwtSecret) {
    return serverError('enforce_unavailable');
  }

  // 2. Authenticate
  const token = extractBearerToken(request);
  if (!token) return unauthorized();

  const claims = await resolveAuth(token, jwtSecret);
  if (!claims) return unauthorized();

  // 3. Parse request body
  let body: {
    diff?: unknown;
    files?: unknown;
    project_id?: unknown;
    anthropic_api_key?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest('invalid_body');
  }

  const diff = typeof body.diff === 'string' ? body.diff : '';
  const files = Array.isArray(body.files)
    ? (body.files as string[]).filter((f) => typeof f === 'string')
    : [];

  if (!diff && files.length === 0) {
    return badRequest('diff_or_files_required');
  }

  const projectId =
    typeof body.project_id === 'string'
      ? body.project_id
      : claims.projectId;

  // Anthropic API key: from request body or server env
  const anthropicApiKey =
    typeof body.anthropic_api_key === 'string'
      ? body.anthropic_api_key
      : process.env.ANTHROPIC_API_KEY;

  if (!anthropicApiKey) {
    return badRequest('anthropic_api_key_required');
  }

  // 4. Infer affected areas from file paths
  const areas = inferAreas(files);

  if (areas.length === 0) {
    // No areas inferred — nothing to check
    const response: EnforceResponse = {
      pass: true,
      violations: [],
      decisions_checked: 0,
      files_checked: files.length,
      areas_searched: [],
    };
    return jsonResponse(response, 200);
  }

  try {
    // 5. Search for relevant decisions
    const decisions = await searchDecisions(
      qdrantUrl,
      qdrantApiKey,
      claims.orgId,
      projectId,
      areas,
    );

    if (decisions.length === 0) {
      const response: EnforceResponse = {
        pass: true,
        violations: [],
        decisions_checked: 0,
        files_checked: files.length,
        areas_searched: areas,
      };
      return jsonResponse(response, 200);
    }

    // 6. Analyze violations with Claude Haiku
    const violations = await analyzeViolations(
      anthropicApiKey,
      decisions,
      diff,
      files,
    );

    const response: EnforceResponse = {
      pass: violations.length === 0,
      violations,
      decisions_checked: decisions.length,
      files_checked: files.length,
      areas_searched: areas,
    };

    return jsonResponse(response, 200);
  } catch (err) {
    console.error('[enforce] Error:', (err as Error).message);
    // Fail-open: if enforcement fails, don't block CI
    const response: EnforceResponse = {
      pass: true,
      violations: [],
      decisions_checked: 0,
      files_checked: files.length,
      areas_searched: areas,
    };
    return jsonResponse(response, 200);
  }
}
