/**
 * T021: Contract tests for registration routes.
 *
 * Tests: register returns 201 with required fields, validation errors (400),
 * rate limiting (429), org name conflict (409).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase-server
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: vi.fn(() => mockSupabase),
}));

// Mock api-keys to return deterministic values
vi.mock('@/lib/api-keys', () => ({
  generateOrgApiKey: vi.fn(() => 'tm_0000000000000000000000000000abcd'),
  generateMemberKey: vi.fn(() => 'tmm_0000000000000000000000000000abcd'),
  generateInviteCode: vi.fn(() => 'ABCD-1234'),
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: vi.fn(() => '00000000-0000-0000-0000-000000000001'),
});

import { POST } from '../register/route';
import { NextRequest } from 'next/server';

function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/register', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
      ...headers,
    },
  });
}

function mockChain(returnValue: unknown) {
  const resolved = Promise.resolve(returnValue);
  const makeThenable = (obj: Record<string, unknown>) => {
    obj.then = (resolved as Promise<unknown>).then.bind(resolved);
    return obj;
  };
  const chain: Record<string, unknown> = {};
  const self = () => makeThenable({ ...chain });
  chain.select = vi.fn().mockImplementation(self);
  chain.eq = vi.fn().mockImplementation(self);
  chain.ilike = vi.fn().mockImplementation(self);
  chain.is = vi.fn().mockImplementation(self);
  chain.gte = vi.fn().mockImplementation(self);
  chain.limit = vi.fn().mockImplementation(self);
  chain.insert = vi.fn().mockImplementation(self);
  chain.delete = vi.fn().mockImplementation(self);
  chain.single = vi.fn().mockResolvedValue(returnValue);
  chain.maybeSingle = vi.fn().mockResolvedValue(returnValue);
  return chain;
}

describe('POST /api/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.QDRANT_URL = 'https://test.qdrant.io';
    process.env.QDRANT_API_KEY = 'test-qdrant-key';
  });

  it('returns 400 when org_name is missing', async () => {
    const response = await POST(makeRequest({ project_name: 'proj', author_name: 'alice' }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe('org_name_required');
  });

  it('returns 400 when project_name is missing', async () => {
    const response = await POST(makeRequest({ org_name: 'org', author_name: 'alice' }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe('project_name_required');
  });

  it('returns 400 when author_name is missing', async () => {
    const response = await POST(makeRequest({ org_name: 'org', project_name: 'proj' }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe('author_name_required');
  });

  it('returns 400 for invalid org_name', async () => {
    const response = await POST(makeRequest({
      org_name: '!!!invalid!!!',
      project_name: 'proj',
      author_name: 'alice',
    }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_name');
    expect(body.field).toBe('org_name');
  });

  it('returns 429 when rate limit exceeded', async () => {
    // Rate limit check returns count >= 10
    const rlChain = mockChain({ count: 10, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'registration_rate_limits') return rlChain;
      return mockChain({ data: null, error: null });
    });

    const response = await POST(makeRequest({
      org_name: 'TestOrg',
      project_name: 'TestProject',
      author_name: 'alice',
    }));
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(body.error).toBe('rate_limit_exceeded');
  });

  it('returns 409 when org name is taken', async () => {
    const rlChain = mockChain({ count: 0, error: null });
    const orgsChain = mockChain({ data: { id: 'existing-id' }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'registration_rate_limits') return rlChain;
      if (table === 'orgs') return orgsChain;
      return mockChain({ data: null, error: null });
    });

    const response = await POST(makeRequest({
      org_name: 'ExistingOrg',
      project_name: 'proj',
      author_name: 'alice',
    }));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toBe('org_name_taken');
  });

  it('returns 201 with all required fields on success', async () => {
    const rlChain = mockChain({ count: 0, error: null });
    const orgsNoneChain = mockChain({ data: null, error: { code: 'PGRST116' } });
    const orgsInsertChain = mockChain({ error: null });
    const membersChain = mockChain({ data: { id: '00000000-0000-0000-0000-000000000002' }, error: null });
    const projectsChain = mockChain({ error: null });
    const pmChain = mockChain({ error: null });
    const auditChain = mockChain({ error: null });
    const rlInsertChain = mockChain({ error: null });

    let orgsCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'registration_rate_limits') {
        // First call is rate limit check, subsequent calls are inserts
        return rlChain;
      }
      if (table === 'orgs') {
        orgsCallCount++;
        if (orgsCallCount === 1) return orgsNoneChain; // uniqueness check
        return orgsInsertChain; // insert
      }
      if (table === 'members') return membersChain;
      if (table === 'projects') return projectsChain;
      if (table === 'project_members') return pmChain;
      if (table === 'audit_entries') return auditChain;
      return mockChain({ data: null, error: null });
    });

    const response = await POST(makeRequest({
      org_name: 'NewOrg',
      project_name: 'NewProject',
      author_name: 'alice',
    }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.member_api_key).toMatch(/^tmm_/);
    expect(body.supabase_url).toBe('https://test.supabase.co');
    expect(body.qdrant_url).toBe('https://test.qdrant.io');
    expect(body.org_id).toBeDefined();
    expect(body.org_name).toBe('NewOrg');
    expect(body.project_id).toBeDefined();
    expect(body.project_name).toBe('NewProject');
    expect(body.invite_code).toBeDefined();
    expect(body.member_id).toBeDefined();
  });
});
