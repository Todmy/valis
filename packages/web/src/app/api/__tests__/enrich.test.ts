/**
 * T035: Contract tests for POST /api/enrich.
 *
 * Verifies:
 *   - Authenticated request enriches decisions
 *   - Unauthenticated returns 401
 *   - Missing ANTHROPIC_API_KEY returns 503
 *   - Daily budget exceeded returns 429
 *   - Already-enriched decisions are skipped
 *   - Max 20 decisions per call enforced
 *   - Community users rejected with 403
 *
 * All external dependencies (Supabase, Anthropic API, Qdrant) are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before imports so vi.mock hoisting works
// ---------------------------------------------------------------------------

const mockEnrichDecision = vi.fn();
const mockUpdateDecisionPayload = vi.fn();
const mockSupabaseFrom = vi.fn();
const mockSupabaseRpc = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    rpc: (...args: unknown[]) => mockSupabaseRpc(...args),
  }),
}));

vi.mock('@/lib/anthropic', () => ({
  enrichDecision: (...args: unknown[]) => mockEnrichDecision(...args),
}));

vi.mock('@/lib/qdrant-server', () => ({
  updateDecisionPayload: (...args: unknown[]) =>
    mockUpdateDecisionPayload(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from '../enrich/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-001';
const PROJECT_ID = 'proj-test-001';
const MEMBER_ID = 'member-test-001';

function b64url(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function fakeJwt(payload: Record<string, unknown>): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  return `${header}.${body}.fakesig`;
}

const HOSTED_JWT = fakeJwt({
  sub: MEMBER_ID,
  org_id: ORG_ID,
  project_id: PROJECT_ID,
  hosted: true,
});

const COMMUNITY_JWT = fakeJwt({
  sub: MEMBER_ID,
  org_id: ORG_ID,
  project_id: PROJECT_ID,
  // no hosted: true
});

function makeRequest(
  body: unknown,
  token?: string | null,
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token !== null && token !== undefined) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new Request('http://localhost/api/enrich', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Create a fluent-chain mock that records all method calls and resolves
 * to the given value when any terminal call is made. This simulates
 * Supabase PostgREST chaining: .select().eq().eq().in() etc.
 */
function createChainMock(resolvedValue: unknown): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const thenableResult = Promise.resolve(resolvedValue);

  // Make the chain itself thenable so `await chain.eq(...)` works
  const makeThenable = (obj: Record<string, unknown>) => {
    obj.then = (thenableResult as Promise<unknown>).then.bind(thenableResult);
    return obj;
  };

  for (const method of ['select', 'eq', 'in', 'update', 'maybeSingle']) {
    chain[method] = vi.fn().mockImplementation(() => makeThenable({ ...chain }));
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const savedEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.QDRANT_URL = 'https://qdrant.test';
  process.env.QDRANT_API_KEY = 'test-qdrant-key';

  mockSupabaseRpc.mockResolvedValue({ data: null, error: null });
  mockUpdateDecisionPayload.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...savedEnv };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/enrich', () => {
  // ---- Authentication tests ----

  it('returns 401 when no Authorization header', async () => {
    const req = makeRequest({ decision_ids: ['id-1'] }, null);
    const res = await POST(req as never);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  it('returns 401 when JWT is malformed', async () => {
    const req = makeRequest({ decision_ids: ['id-1'] }, 'not-a-jwt');
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 when JWT lacks org_id', async () => {
    const jwt = fakeJwt({ sub: MEMBER_ID, hosted: true });
    const req = makeRequest({ decision_ids: ['id-1'] }, jwt);
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 when JWT lacks sub (member_id)', async () => {
    const jwt = fakeJwt({ org_id: ORG_ID, hosted: true });
    const req = makeRequest({ decision_ids: ['id-1'] }, jwt);
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  // ---- 503 missing Anthropic key ----

  it('returns 503 when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const req = makeRequest({ decision_ids: ['id-1'] }, HOSTED_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('enrichment_unavailable');
    expect(json.message).toBe('ANTHROPIC_API_KEY not configured');
  });

  // ---- 403 community users ----

  it('returns 403 for community users (no hosted claim)', async () => {
    const req = makeRequest({ decision_ids: ['id-1'] }, COMMUNITY_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('community_users_use_local_enrich');
  });

  // ---- 400 validation ----

  it('returns 400 when decision_ids is missing', async () => {
    const req = makeRequest({}, HOSTED_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('decision_ids_required');
  });

  it('returns 400 when decision_ids is empty', async () => {
    const req = makeRequest({ decision_ids: [] }, HOSTED_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('decision_ids_required');
  });

  it('returns 400 when more than 20 decision_ids', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `id-${i}`);
    const req = makeRequest({ decision_ids: ids }, HOSTED_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('max_20_decisions_per_call');
  });

  // ---- 429 budget exceeded ----

  it('returns 429 when daily budget is exceeded', async () => {
    // enrichment_usage returns cost >= ceiling
    const usageChain = createChainMock({
      data: [{ cost_cents: 200 }],
      error: null,
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrichment_usage') return usageChain;
      return createChainMock({ data: [], error: null });
    });

    const req = makeRequest({ decision_ids: ['id-1'] }, HOSTED_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe('daily_enrichment_budget_exceeded');
  });

  // ---- Already-enriched skipped ----

  it('skips already-enriched decisions', async () => {
    const usageChain = createChainMock({ data: [], error: null });
    const decisionsChain = createChainMock({
      data: [
        {
          id: 'dec-1',
          org_id: ORG_ID,
          project_id: PROJECT_ID,
          detail: 'Already classified',
          enriched_by: 'llm',
        },
      ],
      error: null,
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrichment_usage') return usageChain;
      if (table === 'decisions') return decisionsChain;
      return createChainMock({ data: [], error: null });
    });

    const req = makeRequest({ decision_ids: ['dec-1'] }, HOSTED_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enriched).toHaveLength(0);
    expect(json.skipped).toContain('dec-1');
    expect(mockEnrichDecision).not.toHaveBeenCalled();
  });

  // ---- Successful enrichment ----

  it('enriches unenriched decisions and returns results', async () => {
    const usageChain = createChainMock({ data: [], error: null });

    // For decisions table: need to handle both select and update calls
    let decisionsCallCount = 0;
    const decisionsSelectChain = createChainMock({
      data: [
        {
          id: 'dec-1',
          org_id: ORG_ID,
          project_id: PROJECT_ID,
          detail: 'Use Redis for caching',
          enriched_by: null,
        },
      ],
      error: null,
    });
    const decisionsUpdateChain = createChainMock({
      data: null,
      error: null,
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrichment_usage') return usageChain;
      if (table === 'decisions') {
        decisionsCallCount++;
        if (decisionsCallCount === 1) return decisionsSelectChain;
        return decisionsUpdateChain;
      }
      return createChainMock({ data: [], error: null });
    });

    mockEnrichDecision.mockResolvedValue({
      type: 'decision',
      summary: 'Use Redis for session caching',
      affects: ['caching', 'performance'],
      confidence: 0.92,
      tokens_used: 250,
      cost_cents: 1,
    });

    const req = makeRequest({ decision_ids: ['dec-1'] }, HOSTED_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.enriched).toHaveLength(1);
    expect(json.enriched[0]).toMatchObject({
      decision_id: 'dec-1',
      type: 'decision',
      summary: 'Use Redis for session caching',
      affects: ['caching', 'performance'],
      confidence: 0.92,
      tokens_used: 250,
      cost_cents: 1,
    });
    expect(json.total_cost_cents).toBe(1);
    expect(json.daily_budget_remaining_cents).toBe(99); // 100 - 1

    // Verify enrichDecision was called with correct args
    expect(mockEnrichDecision).toHaveBeenCalledWith(
      'Use Redis for caching',
      'sk-ant-test-key',
    );

    // Verify Qdrant was updated
    expect(mockUpdateDecisionPayload).toHaveBeenCalledWith(
      'dec-1',
      ORG_ID,
      expect.objectContaining({
        type: 'decision',
        summary: 'Use Redis for session caching',
        affects: ['caching', 'performance'],
        confidence: 0.92,
      }),
    );

    // Verify usage was logged via RPC
    expect(mockSupabaseRpc).toHaveBeenCalledWith(
      'increment_enrichment_usage',
      expect.objectContaining({
        p_org_id: ORG_ID,
        p_provider: 'anthropic',
        p_decisions: 1,
        p_tokens: 250,
        p_cost_cents: 1,
      }),
    );
  });

  // ---- Qdrant failure is non-fatal ----

  it('succeeds even when Qdrant update fails', async () => {
    const usageChain = createChainMock({ data: [], error: null });
    let decisionsCallCount = 0;
    const selectChain = createChainMock({
      data: [
        {
          id: 'dec-1',
          org_id: ORG_ID,
          project_id: PROJECT_ID,
          detail: 'Test decision',
          enriched_by: null,
        },
      ],
      error: null,
    });
    const updateChain = createChainMock({ data: null, error: null });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrichment_usage') return usageChain;
      if (table === 'decisions') {
        decisionsCallCount++;
        return decisionsCallCount === 1 ? selectChain : updateChain;
      }
      return createChainMock({ data: [], error: null });
    });

    mockEnrichDecision.mockResolvedValue({
      type: 'lesson',
      summary: 'A lesson learned',
      affects: ['testing'],
      confidence: 0.7,
      tokens_used: 120,
      cost_cents: 1,
    });

    mockUpdateDecisionPayload.mockRejectedValue(
      new Error('Qdrant connection timeout'),
    );

    const req = makeRequest({ decision_ids: ['dec-1'] }, HOSTED_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.enriched).toHaveLength(1);
    expect(json.enriched[0].decision_id).toBe('dec-1');
  });

  // ---- Not-found IDs are skipped ----

  it('skips decision IDs not found in the database', async () => {
    const usageChain = createChainMock({ data: [], error: null });
    const decisionsChain = createChainMock({
      data: [], // no decisions found
      error: null,
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrichment_usage') return usageChain;
      if (table === 'decisions') return decisionsChain;
      return createChainMock({ data: [], error: null });
    });

    const req = makeRequest(
      { decision_ids: ['non-existent-id'] },
      HOSTED_JWT,
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.enriched).toHaveLength(0);
    expect(json.skipped).toContain('non-existent-id');
    expect(json.total_cost_cents).toBe(0);
  });
});
