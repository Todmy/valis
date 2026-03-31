# 009: CI Enforcement — GitHub Action

**Status:** In Progress
**Author:** Todmy
**Created:** 2026-03-31

---

## Summary

GitHub Action that checks PRs against VALIS team decisions. Fetches active `constraint` and `pattern` decisions relevant to changed files, sends diff + decisions to Claude Haiku for violation analysis, and blocks merge with explanation if violations are found.

**This is the 10× differentiator.** Turns VALIS from documentation tool into infrastructure tool.

---

## Architecture

```
PR opened/updated
  → GitHub Action triggers
  → Reads PR diff (changed files + patches)
  → POST /api/enforce { diff, files, project_id }
    → Server authenticates (API key → JWT)
    → Server searches Qdrant for relevant active constraint/pattern decisions
    → Server sends diff + decisions to Claude Haiku
    → Server returns violations[]
  → Action posts PR review (approve / request changes)
```

---

## New API Endpoint: `POST /api/enforce`

### Request

```json
{
  "diff": "full unified diff string",
  "files": ["src/auth/login.ts", "src/api/users.ts"],
  "project_id": "uuid (optional, from JWT if absent)"
}
```

### Auth

Bearer token — either:
- API key (`tmm_` / `tm_`) — exchanged internally for JWT
- JWT directly

### Process

1. Extract `org_id` and `project_id` from JWT claims
2. For each changed file, infer affected areas from path segments
3. Search Qdrant for active `constraint` + `pattern` decisions matching those areas
4. If no relevant decisions found → return `{ violations: [], pass: true }`
5. If decisions found → call Claude Haiku with structured prompt:
   - System: "You are a code reviewer checking if a PR diff violates team architectural decisions."
   - User: decisions list + diff
   - Output: JSON array of violations
6. Return violations with decision references

### Response

```json
{
  "pass": false,
  "violations": [
    {
      "decision_id": "uuid",
      "decision_summary": "Always use parameterized queries, never raw SQL",
      "decision_type": "constraint",
      "file": "src/api/users.ts",
      "line": 42,
      "explanation": "This code uses string concatenation to build a SQL query, violating the team constraint against raw SQL."
    }
  ],
  "decisions_checked": 12,
  "files_checked": 3
}
```

---

## GitHub Action: `valis-enforce`

### Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `api-key` | Yes | VALIS API key (`tmm_` or `tm_` prefix) |
| `api-url` | No | VALIS API base URL (default: `https://valis.krukit.co`) |
| `project-id` | No | VALIS project ID (auto-detected from `.valis.json` if absent) |
| `fail-on-violation` | No | Whether to fail the check on violations (default: `true`) |
| `anthropic-api-key` | Yes | Anthropic API key for Claude Haiku analysis |

### Example Workflow

```yaml
name: VALIS Enforce
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  enforce:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: todmy/valis-enforce@v1
        with:
          api-key: ${{ secrets.VALIS_API_KEY }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

---

## Area Inference from File Paths

Simple heuristic mapping file paths to `affects` tags:

```
src/auth/**        → auth
src/api/**         → api, api-design
src/database/**    → database
src/mcp/**         → mcp
supabase/**        → database, supabase
*.test.*           → testing
packages/web/**    → dashboard, web
packages/cli/**    → cli
```

Plus: extract directory names as lowercase tags (e.g., `src/billing/stripe.ts` → `billing`, `stripe`).

---

## Claude Haiku Prompt

```
System: You are a strict code reviewer. You check whether a PR diff violates team architectural decisions.

For each violation found, return a JSON object with:
- decision_id: the ID of the violated decision
- file: the file where the violation occurs
- line: approximate line number (from diff hunk headers)
- explanation: one sentence explaining the violation

If no violations are found, return an empty array.

IMPORTANT: Only flag clear, unambiguous violations. Do not flag stylistic preferences or uncertain cases. When in doubt, do not flag.

Return ONLY a JSON array. No markdown, no explanations outside the array.
```

---

## Decisions

- **Server-side Haiku call**: The `/api/enforce` endpoint calls Claude Haiku, NOT the GitHub Action. This centralizes the AI logic and prevents users from needing to manage Anthropic API keys in CI. UPDATE: For MVP, we accept `anthropic-api-key` as action input and pass to the endpoint, since the server doesn't have per-org Anthropic keys yet.
- **Active only**: Only `status: 'active'` decisions are checked. Deprecated/superseded/proposed are skipped.
- **Types**: Only `constraint` and `pattern` types are enforced. `decision`, `lesson`, `pending` are informational.
- **Fail-open on errors**: If VALIS API is down or Haiku fails, the check passes (with a warning comment). CI should not block on infrastructure failures.
- **Rate limiting**: Enforce endpoint counts against existing search rate limits (no new billing tier needed for MVP).
