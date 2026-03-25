/**
 * T023: Contract tests for billing routes.
 *
 * Tests: check-usage, create-checkout, stripe-webhook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockSupabase = { from: mockFrom, rpc: mockRpc };

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

// Mock stripe module
const mockConstructEvent = vi.fn();
const mockCheckoutSessionsCreate = vi.fn();
const mockCustomersCreate = vi.fn();

vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      webhooks: { constructEvent: mockConstructEvent },
      checkout: { sessions: { create: mockCheckoutSessionsCreate } },
      customers: { create: mockCustomersCreate },
    })),
  };
});

function makeRequest(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
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
    'eq', 'ilike', 'is', 'gte', 'limit', 'order',
    'maybeSingle', 'single', 'in',
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
// Tests: POST /api/check-usage
// ---------------------------------------------------------------------------

describe('POST /api/check-usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should return allowed=true when within limits', async () => {
    // Encode a fake JWT with org_id
    const payload = Buffer.from(
      JSON.stringify({ org_id: 'org-123', sub: 'member-1' }),
    ).toString('base64');
    const fakeJwt = `eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.${payload}.fake-sig`;

    // subscription lookup
    const subChain = chainable({ data: { plan: 'free', status: 'active' }, error: null });
    // rate_limits lookup
    const usageChain = chainable({
      data: { decision_count: 10, search_count_today: 5, member_count: 2 },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') return subChain;
      if (table === 'rate_limits') return usageChain;
      return chainable();
    });

    const { POST } = await import('../check-usage/route');

    const req = makeRequest(
      '/api/check-usage',
      { operation: 'store' },
      { Authorization: `Bearer ${fakeJwt}` },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.allowed).toBe(true);
    expect(json.plan).toBe('free');
  });

  it('should return allowed=false when free tier limit reached (store)', async () => {
    const payload = Buffer.from(
      JSON.stringify({ org_id: 'org-123', sub: 'member-1' }),
    ).toString('base64');
    const fakeJwt = `eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.${payload}.fake-sig`;

    const subChain = chainable({ data: { plan: 'free' }, error: null });
    const usageChain = chainable({
      data: { decision_count: 500, search_count_today: 5, member_count: 2 },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') return subChain;
      if (table === 'rate_limits') return usageChain;
      return chainable();
    });

    const { POST } = await import('../check-usage/route');

    const req = makeRequest(
      '/api/check-usage',
      { operation: 'store' },
      { Authorization: `Bearer ${fakeJwt}` },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.allowed).toBe(false);
    expect(json.plan).toBe('free');
    expect(json.reason).toContain('Free tier limit reached');
    expect(json.upgrade).toBeDefined();
    expect(json.upgrade.message).toContain('Upgrade to Team');
  });

  it('should return overage=true for paid plan exceeding limit', async () => {
    const payload = Buffer.from(
      JSON.stringify({ org_id: 'org-123', sub: 'member-1' }),
    ).toString('base64');
    const fakeJwt = `eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.${payload}.fake-sig`;

    const subChain = chainable({
      data: { plan: 'team', current_period_start: '2026-01-01', current_period_end: '2026-02-01' },
      error: null,
    });
    const usageChain = chainable({
      data: { decision_count: 5000, search_count_today: 10, member_count: 5 },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') return subChain;
      if (table === 'rate_limits') return usageChain;
      return chainable();
    });

    const { POST } = await import('../check-usage/route');

    const req = makeRequest(
      '/api/check-usage',
      { operation: 'store' },
      { Authorization: `Bearer ${fakeJwt}` },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.allowed).toBe(true);
    expect(json.plan).toBe('team');
    expect(json.overage).toBe(true);
    expect(json.overage_rate).toContain('$');
  });

  it('should return 401 when org_id cannot be resolved', async () => {
    const { POST } = await import('../check-usage/route');

    const req = makeRequest('/api/check-usage', { operation: 'store' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/create-checkout
// ---------------------------------------------------------------------------

describe('POST /api/create-checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRICE_TEAM_MONTHLY = 'price_team_monthly';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should return 401 when no auth header', async () => {
    const { POST } = await import('../create-checkout/route');

    const req = makeRequest('/api/create-checkout', {
      org_id: 'org-1',
      plan: 'team',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('unauthorized');
  });

  it('should return 400 when missing parameters', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'A',
    });

    const { POST } = await import('../create-checkout/route');

    const req = makeRequest(
      '/api/create-checkout',
      { plan: 'team' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('missing_parameters');
  });

  it('should return 500 when STRIPE_SECRET_KEY is missing', async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const { POST } = await import('../create-checkout/route');

    const req = makeRequest(
      '/api/create-checkout',
      { org_id: 'org-1', plan: 'team' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('misconfigured');
  });

  it('should return checkout_url on success', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth');
    (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      memberId: 'm1',
      orgId: 'o1',
      role: 'admin',
      authorName: 'A',
    });

    // Mock subscription lookup - no existing customer
    const subChain = chainable({ data: null, error: { code: 'PGRST116' } });
    const orgChain = chainable({ data: { name: 'TestOrg' }, error: null });
    const upsertChain = chainable({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') return Math.random() > 0.5 ? subChain : upsertChain;
      if (table === 'orgs') return orgChain;
      return chainable();
    });

    mockCustomersCreate.mockResolvedValue({ id: 'cus_test_123' });
    mockCheckoutSessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/test-session',
    });

    const { POST } = await import('../create-checkout/route');

    const req = makeRequest(
      '/api/create-checkout',
      { org_id: 'org-1', plan: 'team', billing_cycle: 'monthly' },
      { Authorization: 'Bearer tmm_bbbb111111111111bbbb111111111111' },
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('checkout_url');
    expect(json.checkout_url).toContain('https://checkout.stripe.com');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/stripe-webhook
// ---------------------------------------------------------------------------

describe('POST /api/stripe-webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('should return 400 when stripe-signature header is missing', async () => {
    const { POST } = await import('../stripe-webhook/route');

    const req = makeRequest('/api/stripe-webhook', '{}');
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('missing_signature');
  });

  it('should return 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Signature verification failed');
    });

    const { POST } = await import('../stripe-webhook/route');

    const req = makeRequest('/api/stripe-webhook', '{}', {
      'stripe-signature': 't=123,v1=abc',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('invalid_signature');
  });

  it('should return 200 with received:true for checkout.session.completed', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { org_id: 'org-1', plan: 'team', billing_cycle: 'monthly' },
          customer: 'cus_123',
          subscription: 'sub_123',
        },
      },
    });

    const upsertChain = chainable({ error: null });
    const updateChain = chainable({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') return upsertChain;
      if (table === 'orgs') return updateChain;
      return chainable();
    });

    const { POST } = await import('../stripe-webhook/route');

    const req = makeRequest('/api/stripe-webhook', '{}', {
      'stripe-signature': 't=123,v1=valid',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
  });

  it('should return 200 for invoice.payment_failed event', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: {
        object: {
          customer: 'cus_123',
        },
      },
    });

    const updateChain = chainable({ error: null });
    mockFrom.mockReturnValue(updateChain);

    const { POST } = await import('../stripe-webhook/route');

    const req = makeRequest('/api/stripe-webhook', '{}', {
      'stripe-signature': 't=123,v1=valid',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
  });

  it('should return 500 when Stripe config is missing', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const { POST } = await import('../stripe-webhook/route');

    const req = makeRequest('/api/stripe-webhook', '{}', {
      'stripe-signature': 't=123,v1=abc',
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('misconfigured');
  });
});
