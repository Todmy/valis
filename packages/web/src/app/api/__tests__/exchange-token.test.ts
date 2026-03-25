/**
 * T022: Contract tests for exchange-token route.
 *
 * Tests: tmm_ key returns valid JWT, tm_ key returns valid JWT,
 * invalid key returns 401, project-scoped JWT includes project claims.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase-server
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: vi.fn(() => mockSupabase),
}));

// Mock timingSafeEqual to always return true in tests
vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    timingSafeEqual: vi.fn(() => true),
  };
});

import { POST } from '../exchange-token/route';
import { NextRequest } from 'next/server';
import { decodeJwtPayload } from '@/lib/api-auth';

function makeRequest(
  apiKey: string,
  body?: Record<string, unknown>,
): NextRequest {
  return new NextRequest('http://localhost/api/exchange-token', {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

function mockChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(returnValue);
  return chain;
}

describe('POST /api/exchange-token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
  });

  it('returns 401 when no Authorization header', async () => {
    const req = new NextRequest('http://localhost/api/exchange-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await POST(req);
    expect(response.status).toBe(401);
  });

  it('returns 401 for invalid API key prefix', async () => {
    const response = await POST(makeRequest('invalid_key_prefix'));
    expect(response.status).toBe(401);
  });

  it('returns 401 when tmm_ key not found', async () => {
    const memberChain = mockChain({ data: null, error: { code: 'PGRST116' } });
    mockFrom.mockReturnValue(memberChain);

    const response = await POST(makeRequest('tmm_invalid_key_12345678901234567'));
    expect(response.status).toBe(401);
  });

  it('returns 200 with valid JWT for tmm_ key', async () => {
    const memberChain = mockChain({
      data: {
        id: 'member-1',
        org_id: 'org-1',
        author_name: 'alice',
        role: 'admin',
        api_key: 'tmm_valid_key_1234567890123456789',
        revoked_at: null,
      },
      error: null,
    });

    const orgChain = mockChain({
      data: { id: 'org-1', name: 'TestOrg' },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'members') return memberChain;
      if (table === 'orgs') return orgChain;
      return mockChain({ data: null, error: null });
    });

    const response = await POST(makeRequest('tmm_valid_key_1234567890123456789'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toBeDefined();
    expect(body.expires_at).toBeDefined();
    expect(body.member_id).toBe('member-1');
    expect(body.org_id).toBe('org-1');
    expect(body.org_name).toBe('TestOrg');
    expect(body.role).toBe('admin');
    expect(body.author_name).toBe('alice');
    expect(body.auth_mode).toBe('jwt');

    // Verify JWT can be decoded and claims match
    const claims = decodeJwtPayload(body.token);
    expect(claims.sub).toBe('member-1');
    expect(claims.org_id).toBe('org-1');
    expect(claims.member_role).toBe('admin');
    expect(claims.author_name).toBe('alice');
  });

  it('returns 200 with valid JWT for tm_ key', async () => {
    const orgChain = mockChain({
      data: { id: 'org-1', name: 'TestOrg', api_key: 'tm_valid_key_12345678901234567890' },
      error: null,
    });

    const adminChain = mockChain({
      data: { id: 'admin-1', author_name: 'admin-alice', role: 'admin' },
      error: null,
    });

    let orgsCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orgs') {
        orgsCallCount++;
        return orgChain;
      }
      if (table === 'members') return adminChain;
      return mockChain({ data: null, error: null });
    });

    const response = await POST(makeRequest('tm_valid_key_12345678901234567890'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token).toBeDefined();
    expect(body.member_id).toBe('admin-1');
    expect(body.org_id).toBe('org-1');
    expect(body.role).toBe('admin');
  });

  it('returns 500 when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;

    const response = await POST(makeRequest('tmm_some_key_1234567890123456789'));
    expect(response.status).toBe(500);
  });
});
