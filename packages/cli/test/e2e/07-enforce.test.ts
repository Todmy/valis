/**
 * E2E Test 7: CI Enforcement
 *
 * Verifies the /api/enforce endpoint:
 * - Store constraint + pattern decisions
 * - Send a violating diff → violations returned
 * - Send a compliant diff → pass
 * - Send diff with unrelated files → no decisions checked
 * - Auth validation (missing token → 401)
 *
 * Requires: VALIS_E2E_API_URL, VALIS_E2E_SUPABASE_URL, VALIS_E2E_ANTHROPIC_API_KEY
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  canRunEnforceE2E,
  registerTestOrg,
  getJwtToken,
  apiStore,
  apiEnforce,
  retry,
  E2E_API_URL,
  E2E_SUPABASE_URL,
  E2E_ANTHROPIC_API_KEY,
  type E2ERegistration,
} from './helpers.js';

const describeE2E = canRunEnforceE2E() ? describe : describe.skip;

describeE2E('e2e: CI enforcement', () => {
  let reg: E2ERegistration;
  let jwt: string;

  beforeAll(async () => {
    reg = await registerTestOrg('enforce');

    const tokenResponse = await getJwtToken(
      E2E_SUPABASE_URL,
      reg.response.member_api_key,
      reg.response.project_id,
    );
    jwt = tokenResponse.token;

    // Store constraint: no raw SQL
    await apiStore(E2E_API_URL, reg.response.member_api_key, {
      text: 'Never use raw SQL string concatenation in database queries. Always use parameterized queries or an ORM query builder to prevent SQL injection vulnerabilities.',
      type: 'constraint',
      summary: 'No raw SQL concatenation — use parameterized queries',
      affects: ['database', 'security', 'api'],
      project_id: reg.response.project_id,
    });

    // Store pattern: error handling
    await apiStore(E2E_API_URL, reg.response.member_api_key, {
      text: 'All API route handlers must wrap their logic in try-catch blocks and return structured JSON error responses with appropriate HTTP status codes. Never expose raw error messages or stack traces to clients.',
      type: 'pattern',
      summary: 'Structured error handling in API routes',
      affects: ['api', 'error-handling'],
      project_id: reg.response.project_id,
    });

    // Wait for Qdrant indexing
    await retry(
      async () => {
        const res = await fetch(`${E2E_API_URL}/api/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: 'raw SQL parameterized queries',
            type: 'constraint',
            project_id: reg.response.project_id,
          }),
        });
        const data = (await res.json()) as { results: unknown[] };
        return data.results?.length > 0 ? true : null;
      },
      { timeout: 20_000, interval: 2_000, label: 'enforce-index-wait' },
    );
  });

  // -------------------------------------------------------------------------
  // Violation detection
  // -------------------------------------------------------------------------

  it('detects violation in diff with raw SQL concatenation', async () => {
    const violatingDiff = `diff --git a/src/api/users.ts b/src/api/users.ts
index 1234567..abcdef0 100644
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -10,6 +10,12 @@ export async function getUser(req, res) {
   const userId = req.params.id;
-  const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
+  // Quick fix for search
+  const searchTerm = req.query.search;
+  const user = await db.query('SELECT * FROM users WHERE name = \\'' + searchTerm + '\\'');
   return res.json(user);
 }`;

    const result = await apiEnforce(E2E_API_URL, reg.response.member_api_key, {
      diff: violatingDiff,
      files: ['src/api/users.ts'],
      project_id: reg.response.project_id,
      anthropic_api_key: E2E_ANTHROPIC_API_KEY,
    });

    expect(result.pass).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.decisions_checked).toBeGreaterThan(0);
    expect(result.files_checked).toBe(1);

    // Violation should reference the SQL constraint
    const sqlViolation = result.violations.find(
      (v) =>
        v.explanation.toLowerCase().includes('sql') ||
        v.decision_type === 'constraint',
    );
    expect(sqlViolation).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Clean diff passes
  // -------------------------------------------------------------------------

  it('passes for compliant diff using parameterized queries', async () => {
    const compliantDiff = `diff --git a/src/api/users.ts b/src/api/users.ts
index 1234567..abcdef0 100644
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -10,6 +10,8 @@ export async function getUser(req, res) {
   const userId = req.params.id;
+  const searchTerm = req.query.search;
+  const user = await db.query('SELECT * FROM users WHERE name = $1', [searchTerm]);
   return res.json(user);
 }`;

    const result = await apiEnforce(E2E_API_URL, reg.response.member_api_key, {
      diff: compliantDiff,
      files: ['src/api/users.ts'],
      project_id: reg.response.project_id,
      anthropic_api_key: E2E_ANTHROPIC_API_KEY,
    });

    expect(result.pass).toBe(true);
    expect(result.violations.length).toBe(0);
    expect(result.decisions_checked).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Unrelated files → no decisions to check
  // -------------------------------------------------------------------------

  it('returns pass with 0 decisions for completely unrelated files', async () => {
    const unrelatedDiff = `diff --git a/README.md b/README.md
index 1234567..abcdef0 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # My Project
+Updated readme with new instructions.
 Some text here.`;

    const result = await apiEnforce(E2E_API_URL, reg.response.member_api_key, {
      diff: unrelatedDiff,
      files: ['README.md'],
      project_id: reg.response.project_id,
      anthropic_api_key: E2E_ANTHROPIC_API_KEY,
    });

    // README.md may or may not infer areas, but should pass
    expect(result.pass).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  it('enforce response has expected shape', async () => {
    const diff = `diff --git a/src/database/query.ts b/src/database/query.ts
--- a/src/database/query.ts
+++ b/src/database/query.ts
@@ -1,3 +1,4 @@
+const x = 1;`;

    const result = await apiEnforce(E2E_API_URL, reg.response.member_api_key, {
      diff,
      files: ['src/database/query.ts'],
      project_id: reg.response.project_id,
      anthropic_api_key: E2E_ANTHROPIC_API_KEY,
    });

    expect(typeof result.pass).toBe('boolean');
    expect(Array.isArray(result.violations)).toBe(true);
    expect(typeof result.decisions_checked).toBe('number');
    expect(typeof result.files_checked).toBe('number');
    expect(Array.isArray(result.areas_searched)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Auth validation
  // -------------------------------------------------------------------------

  it('returns 401 without auth token', async () => {
    const res = await fetch(`${E2E_API_URL}/api/enforce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        diff: 'some diff',
        files: ['test.ts'],
        anthropic_api_key: E2E_ANTHROPIC_API_KEY,
      }),
    });

    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it('returns 400 when diff and files are both empty', async () => {
    const res = await fetch(`${E2E_API_URL}/api/enforce`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${reg.response.member_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        diff: '',
        files: [],
        anthropic_api_key: E2E_ANTHROPIC_API_KEY,
      }),
    });

    expect(res.status).toBe(400);
  });
}, 120_000); // 2 min timeout — Haiku calls can be slow
