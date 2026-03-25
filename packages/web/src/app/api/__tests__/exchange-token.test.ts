/**
 * T022: Contract tests for exchange-token route.
 *
 * Tests: JWT minting, key type detection, project-scoped claims.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => mockSupabase,
}));

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>();
  return {
    ...actual,
    extractBearerToken: actual.extractBearerToken,
    authenticateApiKey: vi.fn(),
    decodeJwtPayload: actual.decodeJwtPayload,
    timingSafeEqual: actual.timingSafeEqual,
  };
});

function makeRequest(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function chainable(terminal: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'ilike', 'is', 'gte', 'limit', 'order',
    'maybeSingle', 'single',
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain['single'] = vi.fn().mockResolvedValue(terminal);
  chain['maybeSingle'] = vi.fn().mockResolvedValue(terminal);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/exchange-token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret-key-that-is-long-enough';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should return 401 when no Authorization header is provided', async () => {
    const { POST } = await import('../exchange-token/route');

    const req = makeRequest('/api/exchange-token', {});
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('should return 401 for invalid API key', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { POST } = await import('../exchange-token/route');

    const req = makeRequest('/api/exchange-token', {}, {
      Authorization: 'Bearer tmm_invalid_key_here_padding_pad',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('should return 200 with valid JWT for tmm_ key', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'member-123',
      orgId: 'org-456',
      role: 'admin',
      authorName: 'Alice',
    });

    // Mock org name lookup
    const orgChain = chainable({ data: { name: 'TestOrg' }, error: null });
    mockFrom.mockReturnValue(orgChain);

    const { POST } = await import('../exchange-token/route');

    const req = makeRequest('/api/exchange-token', {}, {
      Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('token');
    expect(json).toHaveProperty('expires_at');
    expect(json).toHaveProperty('member_id', 'member-123');
    expect(json).toHaveProperty('org_id', 'org-456');
    expect(json).toHaveProperty('org_name', 'TestOrg');
    expect(json).toHaveProperty('role', 'admin');
    expect(json).toHaveProperty('author_name', 'Alice');
    expect(json).toHaveProperty('auth_mode', 'jwt');

    // Verify JWT structure
    const tokenParts = json.token.split('.');
    expect(tokenParts).toHaveLength(3);

    // Decode and verify claims
    const payload = JSON.parse(
      Buffer.from(tokenParts[1], 'base64').toString('utf-8'),
    );
    expect(payload.sub).toBe('member-123');
    expect(payload.org_id).toBe('org-456');
    expect(payload.member_role).toBe('admin');
    expect(payload.author_name).toBe('Alice');
    expect(payload.iss).toBe('teamind');
    expect(payload.role).toBe('authenticated');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('should return 200 with valid JWT for tm_ key', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'admin-member-id',
      orgId: 'org-789',
      role: 'admin',
      authorName: 'OrgAdmin',
    });

    const orgChain = chainable({ data: { name: 'OrgForKey' }, error: null });
    mockFrom.mockReturnValue(orgChain);

    const { POST } = await import('../exchange-token/route');

    const req = makeRequest('/api/exchange-token', {}, {
      Authorization: 'Bearer tm_aaaa000000000000aaaa000000000000',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.token).toBeDefined();
    expect(json.auth_mode).toBe('jwt');
    expect(json.member_id).toBe('admin-member-id');
  });

  it('should return 500 when JWT_SECRET is not configured', async () => {
    delete process.env.JWT_SECRET;

    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'A',
    });

    const { POST } = await import('../exchange-token/route');

    const req = makeRequest('/api/exchange-token', {}, {
      Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('token_generation_failed');
  });
});
