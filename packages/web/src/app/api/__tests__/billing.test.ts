/**
 * T023: Contract tests for billing routes.
 *
 * Tests: check-usage allowed/denied/overage, create-checkout returns URL,
 * stripe-webhook processes events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// check-usage tests
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockSupabase = { from: mockFrom, rpc: mockRpc };

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    timingSafeEqual: vi.fn(() => true),
    authenticateApiKey: vi.fn().mockResolvedValue({
      memberId: 'member-1',
      orgId: 'org-1',
      role: 'admin',
      authorName: 'alice',
    }),
  };
});

import { POST as checkUsagePOST } from '../check-usage/route';
import { POST as createCheckoutPOST } from '../create-checkout/route';
import { POST as stripeWebhookPOST } from '../stripe-webhook/route';
import { NextRequest } from 'next/server';

function mockChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(returnValue);
  chain.upsert = vi.fn().mockResolvedValue({ error: null });
  chain.update = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  return chain;
}

describe('POST /api/check-usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns allowed=true for usage within limits', async () => {
    const subChain = mockChain({ data: { plan: 'free' }, error: null });
    const usageChain = mockChain({
      data: { decision_count: 10, search_count_today: 5, member_count: 2 },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') return subChain;
      if (table === 'rate_limits') return usageChain;
      return mockChain({ data: null, error: null });
    });

    // Create a JWT-like token for the auth header
    const jwtPayload = Buffer.from(JSON.stringify({ org_id: 'org-1' })).toString('base64');
    const fakeJwt = `header.${jwtPayload}.signature`;

    const req = new NextRequest('http://localhost/api/check-usage', {
      method: 'POST',
      body: JSON.stringify({ operation: 'store' }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeJwt}`,
      },
    });

    const response = await checkUsagePOST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.allowed).toBe(true);
    expect(body.plan).toBe('free');
  });

  it('returns allowed=false when free tier limit reached', async () => {
    const subChain = mockChain({ data: { plan: 'free' }, error: null });
    const usageChain = mockChain({
      data: { decision_count: 500, search_count_today: 5, member_count: 2 },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') return subChain;
      if (table === 'rate_limits') return usageChain;
      return mockChain({ data: null, error: null });
    });

    const jwtPayload = Buffer.from(JSON.stringify({ org_id: 'org-1' })).toString('base64');
    const fakeJwt = `header.${jwtPayload}.signature`;

    const req = new NextRequest('http://localhost/api/check-usage', {
      method: 'POST',
      body: JSON.stringify({ operation: 'store' }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeJwt}`,
      },
    });

    const response = await checkUsagePOST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.allowed).toBe(false);
    expect(body.plan).toBe('free');
    expect(body.reason).toContain('Free tier limit reached');
    expect(body.upgrade).toBeDefined();
  });

  it('returns overage=true for paid plan over limit', async () => {
    const subChain = mockChain({
      data: {
        plan: 'team',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date().toISOString(),
      },
      error: null,
    });
    const usageChain = mockChain({
      data: { decision_count: 5000, search_count_today: 5, member_count: 2 },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'subscriptions') return subChain;
      if (table === 'rate_limits') return usageChain;
      return mockChain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({ error: null });

    const jwtPayload = Buffer.from(JSON.stringify({ org_id: 'org-1' })).toString('base64');
    const fakeJwt = `header.${jwtPayload}.signature`;

    const req = new NextRequest('http://localhost/api/check-usage', {
      method: 'POST',
      body: JSON.stringify({ operation: 'store' }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeJwt}`,
      },
    });

    const response = await checkUsagePOST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.allowed).toBe(true);
    expect(body.overage).toBe(true);
    expect(body.plan).toBe('team');
  });
});

// ---------------------------------------------------------------------------
// create-checkout tests
// ---------------------------------------------------------------------------

describe('POST /api/create-checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_PRICE_TEAM_MONTHLY = 'price_team_monthly';
  });

  it('returns 500 when STRIPE_SECRET_KEY is missing', async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const req = new NextRequest('http://localhost/api/create-checkout', {
      method: 'POST',
      body: JSON.stringify({ org_id: 'org-1', plan: 'team' }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tmm_valid_key',
      },
    });

    const response = await createCheckoutPOST(req);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('misconfigured');
  });

  it('returns 401 when no auth token', async () => {
    const req = new NextRequest('http://localhost/api/create-checkout', {
      method: 'POST',
      body: JSON.stringify({ org_id: 'org-1', plan: 'team' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await createCheckoutPOST(req);
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// stripe-webhook tests
// ---------------------------------------------------------------------------

describe('POST /api/stripe-webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
  });

  it('returns 500 when STRIPE_SECRET_KEY is missing', async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const req = new NextRequest('http://localhost/api/stripe-webhook', {
      method: 'POST',
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'sig_test',
      },
    });

    const response = await stripeWebhookPOST(req);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('misconfigured');
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const req = new NextRequest('http://localhost/api/stripe-webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await stripeWebhookPOST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('missing_signature');
  });

  it('returns 400 when signature verification fails', async () => {
    const req = new NextRequest('http://localhost/api/stripe-webhook', {
      method: 'POST',
      body: '{"type": "checkout.session.completed"}',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid_sig',
      },
    });

    const response = await stripeWebhookPOST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_signature');
  });
});
