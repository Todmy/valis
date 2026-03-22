# Secret Detection Patterns: Teamind MVP

**Source**: design-spec-v5.md § 2 "Secret Detection (before storage)"
**Used by**: T014 (packages/cli/src/security/secrets.ts)

## Behavior

Block entire record if ANY pattern matches. Don't redact, don't store.
Applies to all capture layers (MCP store, file watcher, stop hook, seed).

Agent receives: `{error: "secret_detected", pattern: "<name>", action: "blocked"}`

## 10 Patterns

| # | Name | Regex |
|---|------|-------|
| 1 | AWS Access Key | `AKIA[0-9A-Z]{16}` |
| 2 | Anthropic API Key | `sk-ant-[a-zA-Z0-9_-]{80,}` |
| 3 | OpenAI API Key | `sk-[a-zA-Z0-9]{20,}T3BlbkFJ` or `sk-proj-[a-zA-Z0-9_-]{80,}` |
| 4 | GitHub Token | `ghp_[A-Za-z0-9]{36}` or `github_pat_` or `gho_` |
| 5 | Private Key | `-----BEGIN (RSA \|EC )?PRIVATE KEY-----` |
| 6 | JWT | `eyJ[A-Za-z0-9_-]{10,}\.eyJ` |
| 7 | Database URL | `(postgres\|mysql\|mongodb\|redis)://[^\s]+@` |
| 8 | Slack Token | `xox[bpras]-[0-9]{10,}` |
| 9 | Stripe Key | `(sk\|pk)_(test\|live)_[A-Za-z0-9]{24,}` |
| 10 | Generic Secret | `(password\|secret\|token\|api_key)\s*[:=]\s*['"][^\s]{8,}` |

## Implementation Notes

- All patterns are case-sensitive as written above.
- Pattern #3 (OpenAI) has two variants — match either.
- Pattern #4 (GitHub) has three prefixes — match any.
- Pattern #10 (Generic) has the highest false positive risk — test
  with legitimate text that contains words like "token" in prose.
- Test each pattern with both real examples and false positives.
