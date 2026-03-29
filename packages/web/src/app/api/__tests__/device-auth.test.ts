/**
 * Tests for device authorization endpoints:
 * - POST /api/device-code (generate device code)
 * - POST /api/device-authorize (CLI polling)
 * - POST /api/device-approve (dashboard approval/denial)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabaseFrom = vi.fn();
const mockSupabaseAuthGetUser = vi.fn();
const mockSupabaseAuthAdminCreateUser = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    auth: {
      getUser: (...args: unknown[]) => mockSupabaseAuthGetUser(...args),
      admin: { createUser: (...args: unknown[]) => mockSupabaseAuthAdminCreateUser(...args) },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function mockChain(data: unknown, error: unknown = null, extra: Record<string, unknown> = {}) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    ...extra,
  };
  // For count queries
  if ('count' in extra) {
    chain.select = vi.fn().mockReturnValue({
      ...chain,
      eq: vi.fn().mockReturnValue({
        ...chain,
        gte: vi.fn().mockResolvedValue({ count: extra.count, error: null }),
      }),
    });
  }
  return chain;
}

// ---------------------------------------------------------------------------
// POST /api/device-code
// ---------------------------------------------------------------------------

describe('POST /api/device-code', () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../device-code/route');
    POST = mod.POST as (req: Request) => Promise<Response>;
  });

  it('returns 201 with user_code, device_code, verification_url', async () => {
    // Rate limit check returns 0
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'device_codes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
            }),
          }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return mockChain(null);
    });

    const req = makeRequest({});
    const res = await POST(req as never);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.user_code).toMatch(/^[A-Z]{4}-\d{4}$/);
    expect(json.device_code).toBeDefined();
    expect(json.verification_url).toContain(json.user_code);
    expect(json.expires_in).toBe(900);
    expect(json.interval).toBe(5);
  });

  it('returns 429 when rate limited', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({ count: 3, error: null }),
        }),
      }),
    });

    const req = makeRequest({});
    const res = await POST(req as never);
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// POST /api/device-authorize
// ---------------------------------------------------------------------------

describe('POST /api/device-authorize', () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../device-authorize/route');
    POST = mod.POST as (req: Request) => Promise<Response>;
  });

  it('returns 400 when device_code missing', async () => {
    const req = makeRequest({});
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 for invalid device_code', async () => {
    mockSupabaseFrom.mockReturnValue(mockChain(null, { message: 'not found' }));
    const req = makeRequest({ device_code: 'invalid' });
    const res = await POST(req as never);
    expect(res.status).toBe(404);
  });

  it('returns 202 for pending code', async () => {
    mockSupabaseFrom.mockReturnValue(mockChain({
      id: 'test-id',
      status: 'pending',
      expires_at: new Date(Date.now() + 60000).toISOString(),
      member_id: null,
      member_api_key: null,
    }));

    const req = makeRequest({ device_code: 'valid-code' });
    const res = await POST(req as never);
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.status).toBe('authorization_pending');
  });

  it('returns 410 for expired code', async () => {
    const chain = mockChain({
      id: 'test-id',
      status: 'pending',
      expires_at: new Date(Date.now() - 60000).toISOString(),
      member_id: null,
      member_api_key: null,
    });
    chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockSupabaseFrom.mockReturnValue(chain);

    const req = makeRequest({ device_code: 'expired-code' });
    const res = await POST(req as never);
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error).toBe('expired');
  });

  it('returns 403 for denied code', async () => {
    mockSupabaseFrom.mockReturnValue(mockChain({
      id: 'test-id',
      status: 'denied',
      expires_at: new Date(Date.now() + 60000).toISOString(),
    }));

    const req = makeRequest({ device_code: 'denied-code' });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('denied');
  });

  it('returns 200 with credentials for approved code', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'device_codes') {
        return mockChain({
          id: 'test-id',
          status: 'approved',
          expires_at: new Date(Date.now() + 60000).toISOString(),
          member_id: 'member-1',
          member_api_key: 'tmm_test123',
        });
      }
      if (table === 'members') {
        return mockChain({
          id: 'member-1',
          author_name: 'Dmytro',
          org_id: 'org-1',
          role: 'admin',
        });
      }
      if (table === 'orgs') {
        return mockChain({ name: 'krukit' });
      }
      return mockChain(null);
    });

    const req = makeRequest({ device_code: 'approved-code' });
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.member_api_key).toBe('tmm_test123');
    expect(json.author_name).toBe('Dmytro');
    expect(json.org_name).toBe('krukit');
  });
});

// ---------------------------------------------------------------------------
// POST /api/device-approve
// ---------------------------------------------------------------------------

describe('POST /api/device-approve', () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../device-approve/route');
    POST = mod.POST as (req: Request) => Promise<Response>;
  });

  it('returns 401 without auth header', async () => {
    const req = makeRequest({ user_code: 'ABCD-1234', action: 'approve' });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid auth token', async () => {
    mockSupabaseAuthGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid' },
    });

    const req = makeRequest(
      { user_code: 'ABCD-1234', action: 'approve' },
      { authorization: 'Bearer invalid-token' },
    );
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid code format', async () => {
    mockSupabaseAuthGetUser.mockResolvedValue({
      data: { user: { email: 'test@test.com' } },
      error: null,
    });

    const req = makeRequest(
      { user_code: 'invalid', action: 'approve' },
      { authorization: 'Bearer valid-token' },
    );
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it('approves valid code and returns member info', async () => {
    mockSupabaseAuthGetUser.mockResolvedValue({
      data: { user: { email: 'dmytro@krukit.co' } },
      error: null,
    });

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'device_codes') {
        const chain = mockChain({
          id: 'code-1',
          status: 'pending',
          expires_at: new Date(Date.now() + 60000).toISOString(),
        });
        chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
        return chain;
      }
      if (table === 'members') {
        return mockChain({
          id: 'member-1',
          api_key: 'tmm_test',
          author_name: 'Dmytro',
          org_id: 'org-1',
        });
      }
      if (table === 'orgs') {
        return mockChain({ name: 'krukit' });
      }
      return mockChain(null);
    });

    const req = makeRequest(
      { user_code: 'ABCD-1234', action: 'approve' },
      { authorization: 'Bearer valid-token' },
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('approved');
    expect(json.author_name).toBe('Dmytro');
  });

  it('denies code when action is deny', async () => {
    mockSupabaseAuthGetUser.mockResolvedValue({
      data: { user: { email: 'test@test.com' } },
      error: null,
    });

    const chain = mockChain({
      id: 'code-1',
      status: 'pending',
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockSupabaseFrom.mockReturnValue(chain);

    const req = makeRequest(
      { user_code: 'ABCD-1234', action: 'deny' },
      { authorization: 'Bearer valid-token' },
    );
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('denied');
  });

  it('returns 410 for expired code', async () => {
    mockSupabaseAuthGetUser.mockResolvedValue({
      data: { user: { email: 'test@test.com' } },
      error: null,
    });

    const chain = mockChain({
      id: 'code-1',
      status: 'pending',
      expires_at: new Date(Date.now() - 60000).toISOString(),
    });
    chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockSupabaseFrom.mockReturnValue(chain);

    const req = makeRequest(
      { user_code: 'ABCD-1234', action: 'approve' },
      { authorization: 'Bearer valid-token' },
    );
    const res = await POST(req as never);
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error).toBe('expired');
  });
});
