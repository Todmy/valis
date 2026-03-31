/**
 * E2E Test 8: Contradiction detection
 *
 * Verifies the two-tier contradiction detection:
 * - Store decision A with affects = ['auth', 'security']
 * - Store conflicting decision B with overlapping affects
 * - Seed endpoint may detect contradictions
 * - Search returns both decisions
 * - Deprecating one should still keep the other active
 *
 * Note: Contradiction detection happens in the MCP store handler
 * (two-tier: area overlap + cosine similarity). The /api/seed endpoint
 * performs server-side store which may not run full contradiction logic.
 * This test verifies the decisions are stored and the conflict is
 * visible via search.
 *
 * Requires: VALIS_E2E_API_URL, VALIS_E2E_SUPABASE_URL
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  canRunE2E,
  registerTestOrg,
  getJwtToken,
  apiStore,
  apiSearch,
  apiChangeStatus,
  retry,
  E2E_API_URL,
  E2E_SUPABASE_URL,
  type E2ERegistration,
} from './helpers.js';

const describeE2E = canRunE2E() ? describe : describe.skip;

describeE2E('e2e: contradiction detection', () => {
  let reg: E2ERegistration;
  let jwt: string;
  let decisionAId: string;
  let decisionBId: string;

  const DECISION_A =
    'Authentication tokens must expire after 15 minutes for security compliance. Short-lived JWTs reduce the window for token theft attacks.';
  const DECISION_B =
    'Authentication tokens should have a 24-hour expiry to reduce friction for users. Long-lived tokens improve developer experience by avoiding frequent re-authentication.';

  beforeAll(async () => {
    reg = await registerTestOrg('contradiction');

    const tokenResponse = await getJwtToken(
      E2E_SUPABASE_URL,
      reg.response.member_api_key,
      reg.response.project_id,
    );
    jwt = tokenResponse.token;
  });

  // -------------------------------------------------------------------------
  // Store conflicting decisions
  // -------------------------------------------------------------------------

  it('stores decision A (short token expiry)', async () => {
    const result = await apiStore(E2E_API_URL, reg.response.member_api_key, {
      text: DECISION_A,
      type: 'constraint',
      summary: '15-minute JWT expiry for security',
      affects: ['auth', 'security', 'jwt'],
      project_id: reg.response.project_id,
    });

    expect(result.stored).toBe(1);
  });

  it('stores decision B (long token expiry — contradicts A)', async () => {
    const result = await apiStore(E2E_API_URL, reg.response.member_api_key, {
      text: DECISION_B,
      type: 'decision',
      summary: '24-hour JWT expiry for developer experience',
      affects: ['auth', 'security', 'jwt'],
      project_id: reg.response.project_id,
    });

    expect(result.stored).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Both decisions visible in search
  // -------------------------------------------------------------------------

  it('search returns both conflicting decisions', async () => {
    const result = await retry(
      async () => {
        const r = await apiSearch(E2E_API_URL, jwt, 'JWT token expiry authentication', {
          project_id: reg.response.project_id,
          limit: 20,
        });
        const has15min = r.results.some((res) =>
          res.detail.toLowerCase().includes('15 minute'),
        );
        const has24hour = r.results.some((res) =>
          res.detail.toLowerCase().includes('24-hour'),
        );
        return has15min && has24hour ? r : null;
      },
      { timeout: 25_000, interval: 2_000, label: 'contradiction-search' },
    );

    const decisionA = result.results.find((r) =>
      r.detail.toLowerCase().includes('15 minute'),
    );
    const decisionB = result.results.find((r) =>
      r.detail.toLowerCase().includes('24-hour'),
    );

    expect(decisionA).toBeTruthy();
    expect(decisionB).toBeTruthy();
    decisionAId = decisionA!.id;
    decisionBId = decisionB!.id;

    // Both should be active
    if (decisionA!.status) expect(decisionA!.status).toBe('active');
    if (decisionB!.status) expect(decisionB!.status).toBe('active');
  });

  // -------------------------------------------------------------------------
  // Resolve contradiction by deprecating one
  // -------------------------------------------------------------------------

  it('deprecates decision B to resolve contradiction', async () => {
    const result = await apiChangeStatus(
      E2E_API_URL,
      jwt,
      decisionBId,
      'deprecated',
      'Contradicts security constraint — 15-minute expiry takes precedence',
    );

    expect(result.decision_id).toBe(decisionBId);
    expect(result.new_status).toBe('deprecated');
  });

  it('after resolution, decision A remains active and B is deprecated', async () => {
    const result = await retry(
      async () => {
        const r = await apiSearch(E2E_API_URL, jwt, 'JWT token expiry', {
          project_id: reg.response.project_id,
          limit: 20,
        });
        const bResult = r.results.find((res) => res.id === decisionBId);
        return bResult?.status === 'deprecated' ? r : null;
      },
      { timeout: 15_000, interval: 2_000, label: 'contradiction-resolved' },
    );

    const aResult = result.results.find((r) => r.id === decisionAId);
    const bResult = result.results.find((r) => r.id === decisionBId);

    expect(aResult).toBeTruthy();
    if (aResult!.status) expect(aResult!.status).toBe('active');

    expect(bResult).toBeTruthy();
    if (bResult!.status) expect(bResult!.status).toBe('deprecated');
  });
}, 90_000);
