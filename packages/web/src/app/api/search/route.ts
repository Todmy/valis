/**
 * Q8: POST /api/search — Qdrant search API proxy for hosted mode.
 *
 * Authenticates via Bearer JWT, performs hybrid search against Qdrant
 * via REST API, and returns results. Hosted users call this instead of
 * connecting to Qdrant directly (no qdrant_api_key needed on client side).
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import {
  jsonResponse,
  unauthorized,
  badRequest,
} from '@/lib/api-response';
import { extractBearerToken } from '@/lib/api-auth';
import { jwtVerify } from 'jose';

export const dynamic = 'force-dynamic';

const COLLECTION_NAME = 'decisions';

// ---------------------------------------------------------------------------
// Qdrant point -> result mapper (mirrors cli/src/cloud/qdrant.ts)
// ---------------------------------------------------------------------------

interface SearchResultPayload {
  id: string;
  score: number;
  type: string;
  summary: string | null;
  detail: string;
  author: string;
  affects: string[];
  created_at: string;
  status?: string;
  replaced_by?: string | null;
  confidence?: number | null;
  pinned?: boolean;
  depends_on?: string[];
  project_id?: string;
  project_name?: string;
}

function mapPointToResult(
  point: { id: string | number; payload?: Record<string, unknown> | null; score?: number },
  score: number,
): SearchResultPayload {
  const payload = (point.payload ?? {}) as Record<string, unknown>;
  return {
    id: point.id as string,
    score,
    type: (payload.type as string) ?? 'pending',
    summary: (payload.summary as string) || null,
    detail: (payload.detail as string) ?? '',
    author: (payload.author as string) ?? '',
    affects: (payload.affects as string[]) || [],
    created_at: (payload.created_at as string) ?? '',
    status: (payload.status as string) || 'active',
    replaced_by: (payload.replaces as string) || null,
    confidence: (payload.confidence as number) ?? null,
    pinned: (payload.pinned as boolean) ?? false,
    depends_on: (payload.depends_on as string[]) ?? [],
    project_id: (payload.project_id as string) ?? undefined,
    project_name: (payload.project_name as string) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Filter builders (mirrors cli/src/cloud/qdrant.ts)
// ---------------------------------------------------------------------------

function buildProjectFilter(
  orgId: string,
  projectId?: string,
  options?: { type?: string },
): Record<string, unknown> {
  const mustClauses: Record<string, unknown>[] = [
    { key: 'org_id', match: { value: orgId } },
  ];

  if (options?.type) {
    mustClauses.push({ key: 'type', match: { value: options.type } });
  }

  if (!projectId) {
    return { must: mustClauses };
  }

  // Match project_id OR missing project_id (legacy points)
  mustClauses.push({
    should: [
      { key: 'project_id', match: { value: projectId } },
      { is_null: { key: 'project_id' } },
    ],
  });

  return { must: mustClauses };
}

function buildAllProjectsFilter(
  orgId: string,
  projectIds: string[],
  options?: { type?: string },
): Record<string, unknown> {
  const mustClauses: Record<string, unknown>[] = [
    { key: 'org_id', match: { value: orgId } },
  ];

  if (options?.type) {
    mustClauses.push({ key: 'type', match: { value: options.type } });
  }

  if (projectIds.length > 0) {
    const shouldClauses: Record<string, unknown>[] = projectIds.map((id) => ({
      key: 'project_id',
      match: { value: id },
    }));
    shouldClauses.push({ is_null: { key: 'project_id' } });
    mustClauses.push({ should: shouldClauses });
  }

  return { must: mustClauses };
}

// ---------------------------------------------------------------------------
// Qdrant REST API helpers (no SDK needed — same pattern as qdrant-server.ts)
// ---------------------------------------------------------------------------

interface QdrantPoint {
  id: string | number;
  payload?: Record<string, unknown> | null;
  score?: number;
}

function qdrantHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['api-key'] = apiKey;
  return headers;
}

/**
 * Qdrant query endpoint — uses server-side embeddings to perform semantic search.
 */
async function qdrantQuery(
  baseUrl: string,
  apiKey: string | undefined,
  filter: Record<string, unknown>,
  query: string,
  limit: number,
): Promise<QdrantPoint[]> {
  const url = `${baseUrl}/collections/${COLLECTION_NAME}/points/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: qdrantHeaders(apiKey),
    body: JSON.stringify({
      query,
      filter,
      limit,
      with_payload: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Qdrant query failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { result: { points: QdrantPoint[] } };
  return data.result.points;
}

/**
 * Qdrant scroll endpoint — payload-filtered fallback when embeddings unavailable.
 */
async function qdrantScroll(
  baseUrl: string,
  apiKey: string | undefined,
  filter: Record<string, unknown>,
  limit: number,
): Promise<QdrantPoint[]> {
  const url = `${baseUrl}/collections/${COLLECTION_NAME}/points/scroll`;
  const res = await fetch(url, {
    method: 'POST',
    headers: qdrantHeaders(apiKey),
    body: JSON.stringify({
      filter,
      limit,
      with_payload: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Qdrant scroll failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { result: { points: QdrantPoint[] } };
  return data.result.points;
}

/**
 * Hybrid search: try query (semantic) first, fall back to scroll (filter-only).
 */
async function hybridSearch(
  baseUrl: string,
  apiKey: string | undefined,
  filter: Record<string, unknown>,
  query: string,
  limit: number,
): Promise<SearchResultPayload[]> {
  try {
    const points = await qdrantQuery(baseUrl, apiKey, filter, query, limit);
    if (points.length > 0) {
      return points.map((p) => mapPointToResult(p, p.score || 0));
    }
    // Semantic search returned nothing — fall back to scroll (payload filter)
  } catch {
    // Query failed — fall back to scroll
  }
  const points = await qdrantScroll(baseUrl, apiKey, filter, limit);
  return points.map((p) => mapPointToResult(p, 0));
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Check Qdrant configuration
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY;

  if (!qdrantUrl) {
    return jsonResponse(
      { error: 'search_unavailable', message: 'QDRANT_URL not configured' },
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
    const { payload } = await jwtVerify(token, secret, { issuer: 'valis' });
    claims = payload as Record<string, unknown>;
  } catch {
    return unauthorized('unauthorized');
  }

  const orgId = claims.org_id as string | undefined;
  const memberId = claims.sub as string | undefined;

  if (!orgId || !memberId) {
    return unauthorized('unauthorized');
  }

  // 3. Parse request body
  let body: {
    query?: unknown;
    type?: unknown;
    limit?: unknown;
    project_id?: unknown;
    all_projects?: unknown;
    member_id?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest('query_required');
  }

  const query = body.query;
  if (typeof query !== 'string' || query.trim().length === 0) {
    return badRequest('query_required');
  }

  const type = typeof body.type === 'string' ? body.type : undefined;
  const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 100) : 10;
  const projectId = typeof body.project_id === 'string' ? body.project_id : undefined;
  const allProjects = body.all_projects === true;
  const requestMemberId = typeof body.member_id === 'string' ? body.member_id : memberId;

  try {
    let results: SearchResultPayload[];

    if (allProjects && requestMemberId) {
      // Cross-project search: query Supabase for accessible projects
      let projectIds: string[] = [];

      try {
        const supabase = createServerClient();
        const { data: memberships } = await supabase
          .from('project_members')
          .select('project_id')
          .eq('member_id', requestMemberId);

        if (memberships && memberships.length > 0) {
          projectIds = memberships.map(
            (m: { project_id: string }) => m.project_id,
          );
        }
      } catch {
        // Fall back to org-wide search
      }

      if (projectIds.length > 0) {
        const filter = buildAllProjectsFilter(orgId, projectIds, { type });
        results = await hybridSearch(qdrantUrl, qdrantApiKey, filter, query, limit);
      } else {
        const filter = buildProjectFilter(orgId, undefined, { type });
        results = await hybridSearch(qdrantUrl, qdrantApiKey, filter, query, limit);
      }
    } else {
      // Standard project-scoped or org-scoped search
      const filter = buildProjectFilter(orgId, projectId, { type });
      results = await hybridSearch(qdrantUrl, qdrantApiKey, filter, query, limit);
    }

    return jsonResponse({ results, count: results.length }, 200);
  } catch (err) {
    console.error('[search] Qdrant search failed:', (err as Error).message);
    return jsonResponse(
      { error: 'search_failed', message: (err as Error).message },
      500,
    );
  }
}
