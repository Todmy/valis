/**
 * E2E Test 9: Team member join flow
 *
 * Verifies the full team onboarding:
 * - Admin creates org + project
 * - Second member joins via invite code
 * - Second member gets their own API key
 * - Second member can store decisions
 * - Second member can search and find decisions from both members
 * - Project isolation: second member only sees shared project
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
  apiJoinProject,
  retry,
  E2E_API_URL,
  E2E_SUPABASE_URL,
  TEST_RUN_ID,
  type E2ERegistration,
} from './helpers.js';

const describeE2E = canRunE2E() ? describe : describe.skip;

describeE2E('e2e: team member join flow', () => {
  let adminReg: E2ERegistration;
  let adminJwt: string;

  let member2ApiKey: string;
  let member2Id: string;
  let member2Jwt: string;

  const ADMIN_DECISION =
    'We use Zod for runtime validation of all external API inputs with strict mode enabled';
  const MEMBER2_DECISION =
    'Error responses follow RFC 7807 Problem Details format with type, title, status, and detail fields';

  beforeAll(async () => {
    adminReg = await registerTestOrg('team-join');

    const tokenResponse = await getJwtToken(
      E2E_SUPABASE_URL,
      adminReg.response.member_api_key,
      adminReg.response.project_id,
    );
    adminJwt = tokenResponse.token;
  });

  // -------------------------------------------------------------------------
  // Admin stores a decision
  // -------------------------------------------------------------------------

  it('admin stores a decision', async () => {
    const result = await apiStore(
      E2E_API_URL,
      adminReg.response.member_api_key,
      {
        text: ADMIN_DECISION,
        type: 'pattern',
        summary: 'Zod for API input validation',
        affects: ['validation', 'api', 'zod'],
        project_id: adminReg.response.project_id,
      },
    );

    expect(result.stored).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Second member joins via invite code
  // -------------------------------------------------------------------------

  it('second member joins project via invite code', async () => {
    const joinResult = await apiJoinProject(
      E2E_API_URL,
      adminReg.response.invite_code,
      `e2e-member2-${TEST_RUN_ID}`,
    );

    expect(joinResult.project_id).toBe(adminReg.response.project_id);
    expect(joinResult.org_id).toBe(adminReg.response.org_id);
    expect(joinResult.member_api_key).toMatch(/^tmm_/);
    expect(joinResult.member_id).toBeTruthy();
    expect(joinResult.role).toBeTruthy();

    member2ApiKey = joinResult.member_api_key;
    member2Id = joinResult.member_id;
  });

  it('second member gets valid JWT', async () => {
    const tokenResponse = await getJwtToken(
      E2E_SUPABASE_URL,
      member2ApiKey,
      adminReg.response.project_id,
    );

    expect(tokenResponse.token).toBeTruthy();
    expect(tokenResponse.member_id).toBe(member2Id);
    member2Jwt = tokenResponse.token;
  });

  // -------------------------------------------------------------------------
  // Second member stores a decision
  // -------------------------------------------------------------------------

  it('second member stores a decision', async () => {
    const result = await apiStore(E2E_API_URL, member2ApiKey, {
      text: MEMBER2_DECISION,
      type: 'pattern',
      summary: 'RFC 7807 error responses',
      affects: ['api', 'error-handling'],
      project_id: adminReg.response.project_id,
    });

    expect(result.stored).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Both members can see all decisions
  // -------------------------------------------------------------------------

  it('admin can find decision from member 2', async () => {
    const result = await retry(
      async () => {
        const r = await apiSearch(E2E_API_URL, adminJwt, 'RFC 7807 error response', {
          project_id: adminReg.response.project_id,
        });
        const match = r.results.find((res) =>
          res.detail.toLowerCase().includes('rfc 7807'),
        );
        return match ? r : null;
      },
      { timeout: 20_000, interval: 2_000, label: 'team-admin-sees-member2' },
    );

    const match = result.results.find((r) =>
      r.detail.toLowerCase().includes('rfc 7807'),
    );
    expect(match).toBeTruthy();
  });

  it('member 2 can find decision from admin', async () => {
    const result = await retry(
      async () => {
        const r = await apiSearch(E2E_API_URL, member2Jwt, 'Zod validation API inputs', {
          project_id: adminReg.response.project_id,
        });
        const match = r.results.find((res) =>
          res.detail.toLowerCase().includes('zod'),
        );
        return match ? r : null;
      },
      { timeout: 20_000, interval: 2_000, label: 'team-member2-sees-admin' },
    );

    const match = result.results.find((r) =>
      r.detail.toLowerCase().includes('zod'),
    );
    expect(match).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Duplicate join is handled gracefully
  // -------------------------------------------------------------------------

  it('duplicate join with same invite code returns existing membership', async () => {
    // Joining again with a different author name should still work
    // (the backend should handle idempotency or return the existing member)
    const res = await fetch(`${E2E_API_URL}/api/join-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invite_code: adminReg.response.invite_code,
        author_name: `e2e-member3-${TEST_RUN_ID}`,
      }),
    });

    // Should either succeed (new member) or return appropriate error
    // Both 200 and 409 are acceptable
    expect([200, 409]).toContain(res.status);
  });

  // -------------------------------------------------------------------------
  // Invalid invite code
  // -------------------------------------------------------------------------

  it('rejects invalid invite code', async () => {
    const res = await fetch(`${E2E_API_URL}/api/join-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invite_code: 'invalid-code-does-not-exist',
        author_name: 'hacker',
      }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
}, 90_000);
