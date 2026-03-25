/**
 * T024: Contract tests for admin routes.
 *
 * Tests: change-status, rotate-key, revoke-member, seed, create-project.
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

vi.mock('@/lib/api-keys', () => ({
  generateOrgApiKey: () => 'tm_aaaa000000000000aaaa000000000000',
  generateMemberKey: () => 'tmm_bbbb111111111111bbbb111111111111',
  generateInviteCode: () => 'ABCD-1234',
}));

function makeRequest(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function chainable(terminal: Record<string, unknown> = {}) {
  const resolved = Promise.resolve(terminal);
  const makeThenable = (obj: Record<string, unknown>) => {
    obj.then = (resolved as Promise<unknown>).then.bind(resolved);
    return obj;
  };
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'ilike', 'is', 'gte', 'limit', 'order', 'or', 'contains',
    'maybeSingle', 'single', 'head', 'in',
  ];
  const self = () => makeThenable({ ...chain });
  for (const m of methods) {
    chain[m] = vi.fn().mockImplementation(self);
  }
  chain['single'] = vi.fn().mockResolvedValue(terminal);
  chain['maybeSingle'] = vi.fn().mockResolvedValue(terminal);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests: POST /api/change-status
// ---------------------------------------------------------------------------

describe('POST /api/change-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should return 401 when no auth header', async () => {
    const { POST } = await import('../change-status/route');

    const req = makeRequest('/api/change-status', {
      decision_id: 'dec-1',
      new_status: 'active',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('should return 400 for invalid status', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const { POST } = await import('../change-status/route');

    const req = makeRequest(
      '/api/change-status',
      { decision_id: 'dec-1', new_status: 'invalid' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('invalid_status');
  });

  it('should return 400 for invalid transition (active -> active)', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    // Decision lookup: status is 'active'
    const decisionChain = chainable({
      data: { id: 'dec-1', org_id: 'o1', project_id: 'p1', status: 'deprecated', author_name: 'Alice' },
      error: null,
    });

    mockFrom.mockReturnValue(decisionChain);

    const { POST } = await import('../change-status/route');

    const req = makeRequest(
      '/api/change-status',
      { decision_id: 'dec-1', new_status: 'active' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('invalid_transition');
  });

  it('should return 200 for valid transition (proposed -> active)', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const decisionChain = chainable({
      data: { id: 'dec-1', org_id: 'o1', project_id: 'p1', status: 'proposed', author_name: 'Alice' },
      error: null,
    });
    const updateChain = chainable({ error: null });
    const auditChain = chainable({ error: null });

    let callIdx = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'decisions') {
        callIdx++;
        return callIdx === 1 ? decisionChain : updateChain;
      }
      if (table === 'audit_entries') return auditChain;
      if (table === 'contradictions') return updateChain;
      return chainable();
    });

    const { POST } = await import('../change-status/route');

    const req = makeRequest(
      '/api/change-status',
      { decision_id: 'dec-1', new_status: 'active' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('decision_id', 'dec-1');
    expect(json).toHaveProperty('old_status', 'proposed');
    expect(json).toHaveProperty('new_status', 'active');
    expect(json).toHaveProperty('changed_by', 'Alice');
  });

  it('should return 404 when decision not found', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const notFoundChain = chainable({ data: null, error: { code: 'PGRST116' } });
    mockFrom.mockReturnValue(notFoundChain);

    const { POST } = await import('../change-status/route');

    const req = makeRequest(
      '/api/change-status',
      { decision_id: 'nonexistent', new_status: 'active' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('decision_not_found');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/rotate-key
// ---------------------------------------------------------------------------

describe('POST /api/rotate-key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should return 401 when no auth header', async () => {
    const { POST } = await import('../rotate-key/route');

    const req = makeRequest('/api/rotate-key', { rotate: 'api_key' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('should return 400 for invalid rotate target', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const { POST } = await import('../rotate-key/route');

    const req = makeRequest(
      '/api/rotate-key',
      { rotate: 'nonsense' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('invalid_target');
  });

  it('should return 403 when non-admin tries to rotate org key', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'member',
      authorName: 'Bob',
    });

    const { POST } = await import('../rotate-key/route');

    const req = makeRequest(
      '/api/rotate-key',
      { rotate: 'api_key' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('admin_required');
  });

  it('should return 200 with new org key for api_key rotation', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const updateChain = chainable({ error: null });
    const auditChain = chainable({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'orgs') return updateChain;
      if (table === 'audit_log') return auditChain;
      return chainable();
    });

    const { POST } = await import('../rotate-key/route');

    const req = makeRequest(
      '/api/rotate-key',
      { rotate: 'api_key' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.rotated).toBe('api_key');
    expect(json.new_value).toMatch(/^tm_/);
  });

  it('should return 200 with new invite code for invite_code rotation', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const updateChain = chainable({ error: null });
    mockFrom.mockReturnValue(updateChain);

    const { POST } = await import('../rotate-key/route');

    const req = makeRequest(
      '/api/rotate-key',
      { rotate: 'invite_code' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.rotated).toBe('invite_code');
    expect(json.new_value).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('should return 400 when member_key rotation missing member_id', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const { POST } = await import('../rotate-key/route');

    const req = makeRequest(
      '/api/rotate-key',
      { rotate: 'member_key' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('member_id_required');
  });

  it('should return 200 with new member key for member_key rotation', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    // target member lookup
    const memberChain = chainable({
      data: { id: 'm2', org_id: 'o1', api_key: 'tmm_old' },
      error: null,
    });
    const updateChain = chainable({ error: null });
    const auditChain = chainable({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'members') return memberChain;
      if (table === 'audit_log') return auditChain;
      return updateChain;
    });

    const { POST } = await import('../rotate-key/route');

    const req = makeRequest(
      '/api/rotate-key',
      { rotate: 'member_key', target_member_id: 'm2' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.rotated).toBe('member_key');
    expect(json.new_value).toMatch(/^tmm_/);
    expect(json.target_member_id).toBe('m2');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/revoke-member
// ---------------------------------------------------------------------------

describe('POST /api/revoke-member', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should return 401 when no auth header', async () => {
    const { POST } = await import('../revoke-member/route');

    const req = makeRequest('/api/revoke-member', { member_id: 'm2' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('should return 400 when member_id is missing', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const { POST } = await import('../revoke-member/route');

    const req = makeRequest(
      '/api/revoke-member',
      {},
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('member_id_required');
  });

  it('should return 403 when non-admin tries to revoke', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'member',
      authorName: 'Bob',
    });

    const { POST } = await import('../revoke-member/route');

    const req = makeRequest(
      '/api/revoke-member',
      { member_id: 'm2' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('admin_required');
  });

  it('should return 403 for self-revocation without force', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const { POST } = await import('../revoke-member/route');

    const req = makeRequest(
      '/api/revoke-member',
      { member_id: 'm1' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('cannot_revoke_self');
  });

  it('should return 200 when revoking a member', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    // target member lookup
    const memberChain = chainable({
      data: { id: 'm2', org_id: 'o1', author_name: 'Bob', revoked_at: null },
      error: null,
    });
    const updateChain = chainable({ error: null });
    const auditChain = chainable({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'members') return memberChain;
      if (table === 'audit_log') return auditChain;
      return updateChain;
    });

    const { POST } = await import('../revoke-member/route');

    const req = makeRequest(
      '/api/revoke-member',
      { member_id: 'm2' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('member_id', 'm2');
    expect(json).toHaveProperty('revoked_at');
    expect(json).toHaveProperty('revoked_by', 'm1');
  });

  it('should return 404 when target member not found', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const notFoundChain = chainable({ data: null, error: { code: 'PGRST116' } });
    mockFrom.mockReturnValue(notFoundChain);

    const { POST } = await import('../revoke-member/route');

    const req = makeRequest(
      '/api/revoke-member',
      { member_id: 'nonexistent' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('member_not_found');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/seed
// ---------------------------------------------------------------------------

describe('POST /api/seed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.QDRANT_URL = '';
    process.env.QDRANT_API_KEY = '';
  });

  it('should return 401 when no auth header', async () => {
    const { POST } = await import('../seed/route');

    const req = makeRequest('/api/seed', {
      project_id: 'p1',
      decisions: [{ text: 'test decision text here long enough' }],
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('should return 400 when project_id is missing', async () => {
    // Mock member auth
    const memberChain = chainable({
      data: { id: 'm1', org_id: 'o1', author_name: 'Alice', revoked_at: null },
      error: null,
    });
    mockFrom.mockReturnValue(memberChain);

    const { POST } = await import('../seed/route');

    const req = makeRequest(
      '/api/seed',
      { decisions: [{ text: 'test decision text here long enough' }] },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('project_id_required');
  });

  it('should return 400 when decisions is missing', async () => {
    const memberChain = chainable({
      data: { id: 'm1', org_id: 'o1', author_name: 'Alice', revoked_at: null },
      error: null,
    });
    mockFrom.mockReturnValue(memberChain);

    const { POST } = await import('../seed/route');

    const req = makeRequest(
      '/api/seed',
      { project_id: 'p1' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('decisions_required');
  });

  it('should return 200 with stored/skipped counts on success', async () => {
    // Mock: member auth
    const memberChain = chainable({
      data: { id: 'm1', org_id: 'o1', author_name: 'Alice', revoked_at: null },
      error: null,
    });
    // Mock: project access check
    const pmChain = chainable({ data: { id: 'pm1' }, error: null });
    // Mock: decision insert
    const insertChain = chainable({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'members') return memberChain;
      if (table === 'project_members') return pmChain;
      if (table === 'decisions') return insertChain;
      return chainable();
    });

    const { POST } = await import('../seed/route');

    const req = makeRequest(
      '/api/seed',
      {
        project_id: 'p1',
        decisions: [
          { text: 'Use PostgreSQL for all persistent storage needs' },
          { text: 'short' },  // Will be skipped (< 10 chars)
        ],
      },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('stored');
    expect(json).toHaveProperty('skipped');
    expect(json).toHaveProperty('total');
    expect(json.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/create-project
// ---------------------------------------------------------------------------

describe('POST /api/create-project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should return 401 when no auth header', async () => {
    const { POST } = await import('../create-project/route');

    const req = makeRequest('/api/create-project', {
      org_id: 'o1',
      project_name: 'NewProject',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('should return 400 when project_name is missing', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    const { POST } = await import('../create-project/route');

    const req = makeRequest(
      '/api/create-project',
      { org_id: 'o1' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('project_name_required');
  });

  it('should return 201 with project data on success', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    // subscription lookup
    const subChain = chainable({ data: { plan: 'team' }, error: null });
    // project count
    const countChain = chainable({ count: 0, error: null });
    // project name check
    const nameChain = chainable({ data: null, error: { code: 'PGRST116' } });
    // project insert
    const insertChain = chainable({ error: null });
    // project_members insert
    const pmChain = chainable({ error: null });
    // audit insert
    const auditChain = chainable({ error: null });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') return subChain;
      if (table === 'projects') {
        callCount++;
        if (callCount === 1) return countChain;
        if (callCount === 2) return nameChain;
        return insertChain;
      }
      if (table === 'project_members') return pmChain;
      if (table === 'audit_entries') return auditChain;
      return chainable();
    });

    const { POST } = await import('../create-project/route');

    const req = makeRequest(
      '/api/create-project',
      { org_id: 'o1', project_name: 'New Project' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toHaveProperty('project_id');
    expect(json).toHaveProperty('project_name', 'New Project');
    expect(json).toHaveProperty('invite_code');
    expect(json).toHaveProperty('org_id', 'o1');
    expect(json.invite_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('should return 403 when project limit reached', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'Alice',
    });

    // free plan with 1 project limit
    const subChain = chainable({ data: { plan: 'free' }, error: null });
    // already 1 project
    const countChain = chainable({ count: 1, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') return subChain;
      if (table === 'projects') return countChain;
      return chainable();
    });

    const { POST } = await import('../create-project/route');

    const req = makeRequest(
      '/api/create-project',
      { org_id: 'o1', project_name: 'Another' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('project_limit_reached');
  });
});
