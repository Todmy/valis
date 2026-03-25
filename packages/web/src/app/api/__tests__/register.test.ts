/**
 * T021: Contract tests for registration routes.
 *
 * Tests: register, join-project, join-org, create-org
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

vi.mock('@/lib/api-keys', () => ({
  generateOrgApiKey: () => 'tm_aaaa000000000000aaaa000000000000',
  generateMemberKey: () => 'tmm_bbbb111111111111bbbb111111111111',
  generateInviteCode: () => 'ABCD-1234',
}));

// ---------------------------------------------------------------------------
// Helper to build a NextRequest with JSON body
// ---------------------------------------------------------------------------

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
      'x-forwarded-for': '1.2.3.4',
      ...headers,
    },
  });
}

// Helper to create chainable Supabase query mock
function chainable(terminal: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'ilike', 'is', 'gte', 'limit', 'order', 'or', 'contains',
    'maybeSingle', 'single', 'head',
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal methods return the terminal value
  chain['single'] = vi.fn().mockResolvedValue(terminal);
  chain['maybeSingle'] = vi.fn().mockResolvedValue(terminal);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests: POST /api/register
// ---------------------------------------------------------------------------

describe('POST /api/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.QDRANT_URL = 'https://test.qdrant.io';
    process.env.QDRANT_API_KEY = 'qdrant-key';
  });

  it('should return 201 with all required fields on success', async () => {
    const { POST } = await import('../register/route');

    // rate limit check: no entries
    const rlChain = chainable({ count: 0, error: null });
    // org uniqueness: not found
    const orgCheckChain = chainable({ data: null, error: { code: 'PGRST116' } });
    // org insert: success
    const orgInsertChain = chainable({ error: null });
    // member insert: success
    const memberInsertChain = chainable({ data: { id: 'member-uuid' }, error: null });
    // project insert: success
    const projectInsertChain = chainable({ error: null });
    // project_member insert: success
    const pmInsertChain = chainable({ error: null });
    // audit insert: success
    const auditChain = chainable({ error: null });
    // rate limit insert: success
    const rlInsertChain = chainable({ error: null });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'registration_rate_limits') {
        callCount++;
        return callCount === 1 ? rlChain : rlInsertChain;
      }
      if (table === 'orgs') return callCount <= 2 ? orgCheckChain : orgInsertChain;
      if (table === 'members') return memberInsertChain;
      if (table === 'projects') return projectInsertChain;
      if (table === 'project_members') return pmInsertChain;
      if (table === 'audit_entries') return auditChain;
      return chainable();
    });

    const req = makeRequest('/api/register', {
      org_name: 'TestOrg',
      project_name: 'TestProject',
      author_name: 'Alice',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toHaveProperty('member_api_key');
    expect(json).toHaveProperty('supabase_url');
    expect(json).toHaveProperty('qdrant_url');
    expect(json).toHaveProperty('org_id');
    expect(json).toHaveProperty('org_name', 'TestOrg');
    expect(json).toHaveProperty('project_id');
    expect(json).toHaveProperty('project_name', 'TestProject');
    expect(json).toHaveProperty('invite_code');
    expect(json).toHaveProperty('member_id');
    expect(json.member_api_key).toMatch(/^tmm_/);
  });

  it('should return 400 when org_name is missing', async () => {
    const { POST } = await import('../register/route');

    const req = makeRequest('/api/register', {
      project_name: 'TestProject',
      author_name: 'Alice',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('org_name_required');
  });

  it('should return 400 when project_name is missing', async () => {
    const { POST } = await import('../register/route');

    const req = makeRequest('/api/register', {
      org_name: 'TestOrg',
      author_name: 'Alice',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('project_name_required');
  });

  it('should return 400 when author_name is missing', async () => {
    const { POST } = await import('../register/route');

    const req = makeRequest('/api/register', {
      org_name: 'TestOrg',
      project_name: 'TestProject',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('author_name_required');
  });

  it('should return 400 for invalid org_name', async () => {
    const { POST } = await import('../register/route');

    const req = makeRequest('/api/register', {
      org_name: '!!!invalid!!!',
      project_name: 'TestProject',
      author_name: 'Alice',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('invalid_name');
    expect(json.field).toBe('org_name');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/join-project
// ---------------------------------------------------------------------------

describe('POST /api/join-project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.QDRANT_URL = 'https://test.qdrant.io';
    process.env.QDRANT_API_KEY = 'qdrant-key';
  });

  it('should return 400 when invite_code is missing', async () => {
    const { POST } = await import('../join-project/route');

    const req = makeRequest('/api/join-project', { author_name: 'Bob' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('invite_code_required');
  });

  it('should return 400 when author_name is missing', async () => {
    const { POST } = await import('../join-project/route');

    const req = makeRequest('/api/join-project', { invite_code: 'ABCD-1234' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('author_name_required');
  });

  it('should return 404 for invalid invite code', async () => {
    const { POST } = await import('../join-project/route');

    const chain = chainable({ data: null, error: { code: 'PGRST116' } });
    mockFrom.mockReturnValue(chain);

    const req = makeRequest('/api/join-project', {
      invite_code: 'XXXX-YYYY',
      author_name: 'Bob',
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('invalid_invite_code');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/join-org
// ---------------------------------------------------------------------------

describe('POST /api/join-org', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 when invite_code is missing', async () => {
    const { POST } = await import('../join-org/route');

    const req = makeRequest('/api/join-org', { author_name: 'Bob' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('invite_code_required');
  });

  it('should return 400 when author_name is missing', async () => {
    const { POST } = await import('../join-org/route');

    const req = makeRequest('/api/join-org', { invite_code: 'ABCD-1234' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('author_name_required');
  });

  it('should return 404 for invalid invite code', async () => {
    const { POST } = await import('../join-org/route');

    const chain = chainable({ data: null, error: { code: 'PGRST116' } });
    mockFrom.mockReturnValue(chain);

    const req = makeRequest('/api/join-org', {
      invite_code: 'XXXX-YYYY',
      author_name: 'Bob',
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('invalid_invite_code');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/create-org
// ---------------------------------------------------------------------------

describe('POST /api/create-org', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 when name is missing', async () => {
    const { POST } = await import('../create-org/route');

    const req = makeRequest('/api/create-org', { author_name: 'Alice' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('name_required');
  });

  it('should return 400 when author_name is missing', async () => {
    const { POST } = await import('../create-org/route');

    const req = makeRequest('/api/create-org', { name: 'MyOrg' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('author_name_required');
  });

  it('should return 200 with org data on success', async () => {
    const { POST } = await import('../create-org/route');

    const orgInsert = chainable({ error: null });
    const memberInsert = chainable({ data: { id: 'member-uuid' }, error: null });

    let tableCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orgs') return orgInsert;
      if (table === 'members') return memberInsert;
      return chainable();
    });

    const req = makeRequest('/api/create-org', {
      name: 'NewOrg',
      author_name: 'Alice',
    });

    const res = await POST(req);
    const json = await res.json();

    // create-org returns 200 (not 201 per original EF)
    expect(res.status).toBe(200);
    expect(json).toHaveProperty('org_id');
    expect(json).toHaveProperty('api_key');
    expect(json).toHaveProperty('invite_code');
    expect(json).toHaveProperty('member_id');
    expect(json).toHaveProperty('member_api_key');
    expect(json.role).toBe('admin');
    expect(json.api_key).toMatch(/^tm_/);
    expect(json.member_api_key).toMatch(/^tmm_/);
  });
});
