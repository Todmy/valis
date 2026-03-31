#!/usr/bin/env node

/**
 * VALIS CI Enforcement — GitHub Action script.
 *
 * 1. Fetches PR diff via GitHub API
 * 2. Auto-detects project ID from .valis.json if not provided
 * 3. Calls POST /api/enforce with diff + files
 * 4. Posts PR review comment with results
 * 5. Exits with code 1 if violations found and fail-on-violation is true
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

const API_KEY = process.env.VALIS_API_KEY;
const API_URL = (process.env.VALIS_API_URL || 'https://valis.krukit.co').replace(/\/$/, '');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FAIL_ON_VIOLATION = process.env.FAIL_ON_VIOLATION !== 'false';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PR_NUMBER = process.env.PR_NUMBER;
const REPO_FULL_NAME = process.env.REPO_FULL_NAME;

let PROJECT_ID = process.env.VALIS_PROJECT_ID || '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(outputFile, `${name}=${value}\n`);
  }
}

// ---------------------------------------------------------------------------
// 1. Auto-detect project ID from .valis.json
// ---------------------------------------------------------------------------

async function detectProjectId() {
  if (PROJECT_ID) return;
  const configPath = '.valis.json';
  if (!existsSync(configPath)) return;

  try {
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    if (config.project_id) {
      PROJECT_ID = config.project_id;
      console.log(`[valis] Auto-detected project ID from .valis.json: ${PROJECT_ID}`);
    }
  } catch {
    // Ignore parse errors
  }
}

// ---------------------------------------------------------------------------
// 2. Fetch PR diff via GitHub API
// ---------------------------------------------------------------------------

async function fetchPRDiff() {
  if (!GITHUB_TOKEN || !REPO_FULL_NAME || !PR_NUMBER) {
    throw new Error('Missing GITHUB_TOKEN, REPO_FULL_NAME, or PR_NUMBER');
  }

  const url = `https://api.github.com/repos/${REPO_FULL_NAME}/pulls/${PR_NUMBER}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3.diff',
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API failed (${res.status}): ${await res.text()}`);
  }

  return res.text();
}

/**
 * Fetch list of changed files from GitHub API.
 */
async function fetchChangedFiles() {
  if (!GITHUB_TOKEN || !REPO_FULL_NAME || !PR_NUMBER) return [];

  const url = `https://api.github.com/repos/${REPO_FULL_NAME}/pulls/${PR_NUMBER}/files?per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!res.ok) return [];

  const files = await res.json();
  return files.map((f) => f.filename);
}

// ---------------------------------------------------------------------------
// 3. Call VALIS /api/enforce
// ---------------------------------------------------------------------------

async function callEnforce(diff, files) {
  const url = `${API_URL}/api/enforce`;

  const body = {
    diff,
    files,
    anthropic_api_key: ANTHROPIC_API_KEY,
  };

  if (PROJECT_ID) {
    body.project_id = PROJECT_ID;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`VALIS enforce API failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// 4. Post PR review comment
// ---------------------------------------------------------------------------

async function postPRComment(body) {
  if (!GITHUB_TOKEN || !REPO_FULL_NAME || !PR_NUMBER) return;

  const url = `https://api.github.com/repos/${REPO_FULL_NAME}/issues/${PR_NUMBER}/comments`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
}

// ---------------------------------------------------------------------------
// Format results
// ---------------------------------------------------------------------------

function formatResults(result) {
  if (result.pass && result.violations.length === 0) {
    if (result.decisions_checked === 0) {
      return `## ✅ VALIS Enforce — No Decisions to Check

No active constraint or pattern decisions found for the changed files.

| Metric | Value |
|--------|-------|
| Files checked | ${result.files_checked} |
| Areas searched | ${result.areas_searched.join(', ') || '(none)'} |
| Decisions found | 0 |`;
    }

    return `## ✅ VALIS Enforce — All Clear

No violations found. PR complies with all team decisions.

| Metric | Value |
|--------|-------|
| Files checked | ${result.files_checked} |
| Decisions checked | ${result.decisions_checked} |
| Areas searched | ${result.areas_searched.join(', ')} |`;
  }

  const violationLines = result.violations
    .map(
      (v, i) =>
        `### ${i + 1}. ${v.decision_summary || 'Unnamed decision'}

- **Type:** \`${v.decision_type}\`
- **File:** \`${v.file}\`${v.line ? ` (line ~${v.line})` : ''}
- **Decision ID:** \`${v.decision_id}\`
- **Violation:** ${v.explanation}`,
    )
    .join('\n\n');

  return `## ❌ VALIS Enforce — ${result.violations.length} Violation${result.violations.length === 1 ? '' : 's'} Found

This PR violates team architectural decisions. Please fix before merging.

| Metric | Value |
|--------|-------|
| Files checked | ${result.files_checked} |
| Decisions checked | ${result.decisions_checked} |
| Violations | **${result.violations.length}** |
| Areas searched | ${result.areas_searched.join(', ')} |

${violationLines}

---
*Powered by [VALIS](https://valis.krukit.co) — the enforcement layer for AI teams.*`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[valis] Starting CI Enforcement check...');

  if (!API_KEY) {
    console.error('[valis] Error: VALIS_API_KEY is required');
    process.exit(1);
  }

  if (!ANTHROPIC_API_KEY) {
    console.error('[valis] Error: ANTHROPIC_API_KEY is required');
    process.exit(1);
  }

  // Auto-detect project ID
  await detectProjectId();

  // Fetch PR data
  console.log('[valis] Fetching PR diff...');
  let diff, files;
  try {
    [diff, files] = await Promise.all([fetchPRDiff(), fetchChangedFiles()]);
  } catch (err) {
    console.error(`[valis] Failed to fetch PR data: ${err.message}`);
    console.log('[valis] Failing open — skipping enforcement.');
    await writeOutput('pass', 'true');
    await writeOutput('violations_count', '0');
    await writeOutput('decisions_checked', '0');
    process.exit(0);
  }

  console.log(`[valis] PR has ${files.length} changed files`);
  console.log(`[valis] Diff size: ${diff.length} characters`);

  // Call enforce API
  console.log('[valis] Checking against team decisions...');
  let result;
  try {
    result = await callEnforce(diff, files);
  } catch (err) {
    console.error(`[valis] Enforce API error: ${err.message}`);
    console.log('[valis] Failing open — skipping enforcement.');
    await writeOutput('pass', 'true');
    await writeOutput('violations_count', '0');
    await writeOutput('decisions_checked', '0');
    process.exit(0);
  }

  // Set outputs
  await writeOutput('pass', result.pass ? 'true' : 'false');
  await writeOutput('violations_count', String(result.violations?.length ?? 0));
  await writeOutput('decisions_checked', String(result.decisions_checked ?? 0));

  // Format and post results
  const comment = formatResults(result);
  console.log(comment);

  try {
    await postPRComment(comment);
    console.log('[valis] Posted results as PR comment.');
  } catch (err) {
    console.warn(`[valis] Could not post PR comment: ${err.message}`);
  }

  // Exit
  if (!result.pass && FAIL_ON_VIOLATION) {
    console.log(`[valis] ❌ ${result.violations.length} violation(s) found. Failing check.`);
    process.exit(1);
  }

  console.log('[valis] ✅ Check passed.');
}

main().catch((err) => {
  console.error(`[valis] Unexpected error: ${err.message}`);
  // Fail-open on unexpected errors
  process.exit(0);
});
