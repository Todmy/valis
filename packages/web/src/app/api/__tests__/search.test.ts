/**
 * Q8: Contract tests for POST /api/search.
 *
 * Verifies:
 *   - Authenticated request returns search results
 *   - Unauthenticated returns 401
 *   - Missing QDRANT_URL returns 503
 *   - Missing query returns 400
 *   - all_projects mode queries project_members for accessible projects
 *   - Qdrant search failure returns 500
 *
 * All external dependencies (Qdrant REST API, Supabase) are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before imports so vi.mock hoisting works
// ---------------------------------------------------------------------------

const mockSupabaseFrom = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  }),
}));

// Mock jose to bypass real JWT verification in tests
const mockJwtVerify = vi.fn();
vi.mock('jose', () => ({
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));

// Mock global fetch for Qdrant REST API calls
const mockFetch = vi.fn();

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from '../search/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-001';
const PROJECT_ID = 'proj-test-001';
const MEMBER_ID = 'member-test-001';

const VALID_JWT = 'valid.test.jwt';

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
  return new Request('http://localhost/api/search', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Create a fluent-chain mock for Supabase PostgREST chaining.
 */
function createChainMock(resolvedValue: unknown): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const thenableResult = Promise.resolve(resolvedValue);

  const makeThenable = (obj: Record<string, unknown>) => {
    obj.then = (thenableResult as Promise<unknown>).then.bind(thenableResult);
    return obj;
  };

  for (const method of ['select', 'eq', 'in', 'single']) {
    chain[method] = vi.fn().mockImplementation(() => makeThenable({ ...chain }));
  }

  return chain;
}

/**
 * Build a mock fetch Response with the given JSON body and status.
 */
function mockFetchResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const savedEnv = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.QDRANT_URL = 'https://qdrant.test';
  process.env.QDRANT_API_KEY = 'test-qdrant-key';
  process.env.JWT_SECRET = 'test-jwt-secret-for-search-tests';
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

  // Replace global fetch with mock
  globalThis.fetch = mockFetch;

  // Default: valid JWT verifies successfully
  mockJwtVerify.mockImplementation(async (token: string) => {
    if (token === VALID_JWT) {
      return {
        payload: {
          sub: MEMBER_ID,
          org_id: ORG_ID,
          project_id: PROJECT_ID,
          hosted: true,
        },
      };
    }
    throw new Error('JWSSignatureVerificationFailed');
  });
});

afterEach(() => {
  process.env = { ...savedEnv };
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/search', () => {
  // ---- Authentication tests ----

  it('returns 401 when no Authorization header', async () => {
    const req = makeRequest({ query: 'test' }, null);
    const res = await POST(req as never);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  it('returns 401 when JWT is malformed', async () => {
    const req = makeRequest({ query: 'test' }, 'not-a-jwt');
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 when JWT lacks org_id', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { sub: MEMBER_ID, hosted: true } });
    const req = makeRequest({ query: 'test' }, 'no-org-jwt');
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 when JWT lacks sub (member_id)', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { org_id: ORG_ID, hosted: true } });
    const req = makeRequest({ query: 'test' }, 'no-sub-jwt');
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  // ---- 503 missing Qdrant URL ----

  it('returns 503 when QDRANT_URL is not set', async () => {
    delete process.env.QDRANT_URL;
    const req = makeRequest({ query: 'test' }, VALID_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('search_unavailable');
  });

  // ---- 400 validation ----

  it('returns 400 when query is missing', async () => {
    const req = makeRequest({}, VALID_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('query_required');
  });

  it('returns 400 when query is empty string', async () => {
    const req = makeRequest({ query: '  ' }, VALID_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('query_required');
  });

  // ---- Successful search ----

  it('returns search results from Qdrant query endpoint', async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        result: {
          points: [
            {
              id: 'dec-1',
              score: 0.95,
              payload: {
                org_id: ORG_ID,
                type: 'decision',
                summary: 'Use Redis for caching',
                detail: 'We decided to use Redis',
                author: 'alice',
                affects: ['caching'],
                created_at: '2026-01-15T10:00:00Z',
                status: 'active',
                confidence: 0.9,
                pinned: false,
                depends_on: [],
                project_id: PROJECT_ID,
              },
            },
          ],
        },
      }),
    );

    const req = makeRequest({ query: 'caching strategy' }, VALID_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.count).toBe(1);
    expect(json.results[0]).toMatchObject({
      id: 'dec-1',
      score: 0.95,
      type: 'decision',
      summary: 'Use Redis for caching',
      detail: 'We decided to use Redis',
      author: 'alice',
    });
  });

  it('falls back to scroll when query endpoint fails', async () => {
    // First call (query) fails, second call (scroll) succeeds
    mockFetch
      .mockResolvedValueOnce(
        mockFetchResponse({ error: 'not supported' }, 400),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          result: {
            points: [
              {
                id: 'dec-2',
                payload: {
                  org_id: ORG_ID,
                  type: 'constraint',
                  summary: 'Max 100 connections',
                  detail: 'Database pool limit',
                  author: 'bob',
                  affects: ['database'],
                  created_at: '2026-01-10T10:00:00Z',
                },
              },
            ],
          },
        }),
      );

    const req = makeRequest({ query: 'database limits' }, VALID_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].id).toBe('dec-2');
    expect(json.results[0].score).toBe(0); // fallback has score 0
  });

  // ---- all_projects mode ----

  it('queries project_members when all_projects is true', async () => {
    const pmChain = createChainMock({
      data: [
        { project_id: 'proj-a' },
        { project_id: 'proj-b' },
      ],
      error: null,
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'project_members') return pmChain;
      return createChainMock({ data: [], error: null });
    });

    mockFetch.mockResolvedValue(
      mockFetchResponse({
        result: {
          points: [
            {
              id: 'dec-3',
              score: 0.8,
              payload: {
                org_id: ORG_ID,
                type: 'pattern',
                summary: 'Cross-project result',
                detail: 'Found across projects',
                author: 'charlie',
                affects: [],
                created_at: '2026-02-01T10:00:00Z',
                project_id: 'proj-a',
              },
            },
          ],
        },
      }),
    );

    const req = makeRequest(
      { query: 'cross project', all_projects: true, member_id: MEMBER_ID },
      VALID_JWT,
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].project_id).toBe('proj-a');

    // Verify project_members was queried
    expect(mockSupabaseFrom).toHaveBeenCalledWith('project_members');
  });

  // ---- Error handling ----

  it('returns 500 when both Qdrant query and scroll fail', async () => {
    // Both query and scroll fail
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse({ error: 'fail' }, 500))
      .mockResolvedValueOnce(mockFetchResponse({ error: 'fail' }, 500));

    const req = makeRequest({ query: 'test query' }, VALID_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('search_failed');
  });

  // ---- Limit capping ----

  it('caps limit to 100', async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({ result: { points: [] } }),
    );

    const req = makeRequest({ query: 'test', limit: 200 }, VALID_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    // Verify the Qdrant query was called with capped limit
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/points/query'),
      expect.objectContaining({
        body: expect.stringContaining('"limit":100'),
      }),
    );
  });

  // ---- Type filtering ----

  it('passes type filter to Qdrant', async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({ result: { points: [] } }),
    );

    const req = makeRequest({ query: 'test', type: 'constraint' }, VALID_JWT);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    // Verify the filter includes type clause in the fetch body
    const fetchCall = mockFetch.mock.calls[0];
    const fetchBody = JSON.parse(fetchCall[1].body as string);
    expect(fetchBody.filter.must).toEqual(
      expect.arrayContaining([
        { key: 'type', match: { value: 'constraint' } },
      ]),
    );
  });
});
