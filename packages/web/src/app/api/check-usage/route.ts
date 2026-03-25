/**
 * T014: Check usage route.
 *
 * Authenticated via Bearer JWT. Checks plan limits and returns
 * allowed/denied/overage response.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, unauthorized } from '@/lib/api-response';
import { decodeJwtPayload } from '@/lib/api-auth';

interface PlanLimits {
  decisions: number;
  members: number;
  searches: number;
  overage: boolean;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { decisions: 500, members: 5, searches: 100, overage: false },
  team: { decisions: 5_000, members: 25, searches: 1_000, overage: true },
  business: { decisions: 25_000, members: 50, searches: 5_000, overage: true },
  enterprise: {
    decisions: Infinity,
    members: Infinity,
    searches: Infinity,
    overage: false,
  },
};

const OVERAGE_RATES = {
  decision_cents: 0.5,
  search_cents: 0.2,
} as const;

const PLAN_UPGRADE_NAMES: Record<string, { next: string; price: string }> = {
  free: { next: 'Team', price: '$29/mo' },
  team: { next: 'Business', price: '$99/mo' },
};

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();

    // Extract org_id from JWT
    const authHeader = request.headers.get('authorization') ?? '';
    let orgId: string | undefined;

    if (authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const claims = decodeJwtPayload(token);
        orgId = claims.org_id as string | undefined;
      } catch {
        // JWT decode failed
      }
    }

    const body = await request.json();
    const operation: string = body.operation;

    if (!orgId) {
      orgId = body.org_id;
    }

    if (!orgId || !operation) {
      return unauthorized();
    }

    if (operation !== 'store' && operation !== 'search') {
      return jsonResponse({ error: 'invalid_operation' }, 400);
    }

    // Get subscription
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('plan, status, current_period_start, current_period_end')
      .eq('org_id', orgId)
      .single();

    const plan = sub?.plan ?? 'free';
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

    // Get current usage
    const { data: usage } = await supabase
      .from('rate_limits')
      .select('decision_count, search_count_today, member_count')
      .eq('org_id', orgId)
      .single();

    const decisionCount = usage?.decision_count ?? 0;
    const searchCount = usage?.search_count_today ?? 0;

    // Enterprise — always allowed
    if (plan === 'enterprise') {
      return jsonResponse({ allowed: true, plan, overage: false }, 200);
    }

    // Check store limits
    if (operation === 'store' && decisionCount >= limits.decisions) {
      if (limits.overage) {
        return jsonResponse(
          {
            allowed: true,
            plan,
            overage: true,
            overage_rate: `$${(OVERAGE_RATES.decision_cents / 100).toFixed(3)}/decision`,
          },
          200,
        );
      }

      const upgrade = PLAN_UPGRADE_NAMES[plan];
      return jsonResponse(
        {
          allowed: false,
          plan,
          reason: `Free tier limit reached (${limits.decisions} decisions).`,
          upgrade: {
            message: upgrade
              ? `Upgrade to ${upgrade.next} (${upgrade.price}) for ${PLAN_LIMITS[upgrade.next.toLowerCase()]?.decisions?.toLocaleString() ?? 'more'} decisions.`
              : 'Contact sales for Enterprise.',
            checkout_url: null,
          },
        },
        200,
      );
    }

    // Check search limits
    if (operation === 'search' && searchCount >= limits.searches) {
      if (limits.overage) {
        return jsonResponse(
          {
            allowed: true,
            plan,
            overage: true,
            overage_rate: `$${(OVERAGE_RATES.search_cents / 100).toFixed(3)}/search`,
          },
          200,
        );
      }

      const upgrade = PLAN_UPGRADE_NAMES[plan];
      return jsonResponse(
        {
          allowed: false,
          plan,
          reason: `Free tier limit reached (${limits.searches} searches/day).`,
          upgrade: {
            message: upgrade
              ? `Upgrade to ${upgrade.next} (${upgrade.price}) for ${PLAN_LIMITS[upgrade.next.toLowerCase()]?.searches?.toLocaleString() ?? 'more'} searches/day.`
              : 'Contact sales for Enterprise.',
            checkout_url: null,
          },
        },
        200,
      );
    }

    // Within limits
    return jsonResponse({ allowed: true, plan, overage: false }, 200);
  } catch (err) {
    console.error('check-usage error:', (err as Error).message);
    return jsonResponse(
      { error: 'internal_error', message: (err as Error).message },
      500,
    );
  }
}
