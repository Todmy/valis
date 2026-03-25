# Quickstart: Registration API Validation

## Prerequisites

- Valis Phase 4 (multi-project) installed and working
- Supabase migration 005 applied (registration_rate_limits table)
- `register` Edge Function deployed
- `join-project` Edge Function updated (includes supabase_url/qdrant_url)
- Two machines/terminals for testing join flow

## 1. First-Time Hosted Setup (US1)

```bash
# Fresh machine — no ~/.valis/ directory, no .valis.json
# No .hosted-env file, no VALIS_HOSTED_* env vars

valis init
# Expected: "Choose your setup: 1) Hosted  2) Community"
# Select: 1

# Prompts:
#   Organization name: My Org
#   Project name (my-repo): my-repo
#   Your name: Alice

# Expected output:
#   ✓ Registered with Valis hosted
#   ✓ Organization "My Org" created
#   ✓ Project "my-repo" created
#   ✓ Config saved
#   ✓ Project config saved to .valis.json
#   ...IDE detection, Qdrant setup, seed...
#
#   Invite code: ABCD-1234
#   Share with teammates: valis init --join ABCD-1234

# Verify config:
cat ~/.valis/config.json
# Expected: member_api_key present (tmm_...)
# Expected: supabase_url present
# Expected: qdrant_url present
# Expected: NO supabase_service_role_key field
# Expected: NO qdrant_api_key field

cat .valis.json
# Expected: { "project_id": "uuid", "project_name": "my-repo" }

# Verify subsequent operations work:
valis status
# Expected: "Org: My Org, Project: my-repo, Author: Alice"
```

## 2. Join Existing Project via Invite (US2)

```bash
# Different machine — fresh install, no config
# Using invite code from US1

valis init --join ABCD-1234
# Prompt: Your name: Bob
#
# Expected output:
#   ✓ Joined project "my-repo" in org "My Org"
#   ✓ Config saved
#   ✓ Project config saved to .valis.json
#   ...IDE detection...

cat ~/.valis/config.json
# Expected: member_api_key present (tmm_..., different from Alice's)
# Expected: supabase_url, qdrant_url present
# Expected: NO supabase_service_role_key

valis status
# Expected: "Org: My Org, Project: my-repo, Author: Bob"

# Test invalid invite code:
valis init --join ZZZZ-9999
# Expected: "Invalid invite code. Check the code and try again."
```

## 3. Community Mode Unchanged (US3)

```bash
# Fresh machine
valis init
# Expected: "Choose your setup: 1) Hosted  2) Community"
# Select: 2

# Prompts (same as current):
#   Supabase URL: https://my-instance.supabase.co
#   Supabase Service Role Key: eyJ...
#   Qdrant URL: https://my-cluster.qdrant.io
#   Qdrant API Key: abc123

# Expected: proceeds exactly as current Phase 4 init
# Config includes supabase_service_role_key (community mode)

cat ~/.valis/config.json
# Expected: supabase_service_role_key present
# Expected: supabase_url, qdrant_url, qdrant_api_key present

valis status
# Expected: works as before
```

## 4. No .hosted-env Dependency (US4)

```bash
# Verify .hosted-env is NOT needed:
rm -f ~/.valis/.hosted-env
unset VALIS_HOSTED_SUPABASE_URL
unset VALIS_HOSTED_SUPABASE_KEY
unset VALIS_HOSTED_QDRANT_URL
unset VALIS_HOSTED_QDRANT_KEY

valis init
# Select: Hosted
# Expected: prompts for org name, project name, your name
# Expected: registration succeeds via API (no .hosted-env needed)
# Expected: NO error about "Hosted credentials not configured"

# Verify no service_role key in codebase:
grep -r "service_role" packages/cli/src/commands/init.ts
# Expected: NO matches (or only in community mode path)
```

## 5. Rate Limiting (Edge Case)

```bash
# Register 10 orgs rapidly from the same IP:
for i in $(seq 1 10); do
  curl -s -X POST https://xyz.supabase.co/functions/v1/register \
    -H "Content-Type: application/json" \
    -d "{\"org_name\":\"test-$i\",\"project_name\":\"proj-$i\",\"author_name\":\"user-$i\"}"
done
# Expected: first 10 succeed (201)

# 11th attempt:
curl -s -X POST https://xyz.supabase.co/functions/v1/register \
  -H "Content-Type: application/json" \
  -d '{"org_name":"test-11","project_name":"proj-11","author_name":"user-11"}'
# Expected: 429 { "error": "rate_limit_exceeded" }

# CLI display:
valis init  # (Hosted mode, 11th time from same IP)
# Expected: "Too many registrations from this IP. Try again later."
```

## 6. Error Handling (Edge Cases)

```bash
# Org name taken:
valis init  # Hosted, use same org name as existing org
# Expected: "Organization name already taken. Choose a different name."

# Registration service down:
# (simulate by disconnecting network)
valis init  # Hosted
# Expected: "Valis registration service is currently unavailable.
#            Try again later or use Community mode for self-hosted setup."

# Special characters in names:
valis init  # Hosted
# Org name: "My Org!!!"
# Expected: "Invalid organization name. Use letters, numbers, spaces, and hyphens only."
```

## Validation Checklist

### US1 — First-Time Hosted Setup
- [ ] `valis init` Hosted mode prompts for org name, project name, author name only
- [ ] No URLs or keys requested from user
- [ ] Registration API creates org + project + member atomically
- [ ] `~/.valis/config.json` contains `member_api_key`, `supabase_url`, `qdrant_url`
- [ ] `~/.valis/config.json` does NOT contain `supabase_service_role_key`
- [ ] `.valis.json` created with `project_id` and `project_name`
- [ ] Subsequent `valis status` / store / search work via exchange-token
- [ ] Org name taken shows clear error with retry
- [ ] Network error shows clear error with retry instructions

### US2 — Join Existing Project
- [ ] `valis init --join <code>` works without any pre-existing config
- [ ] CLI calls join-project endpoint, receives full credentials
- [ ] `~/.valis/config.json` has `member_api_key` (no service_role_key)
- [ ] `.valis.json` created with project_id and project_name
- [ ] Invalid invite code shows "Invalid invite code" error
- [ ] Already a project member shows appropriate error
- [ ] Existing org member joining new project is handled (not duplicated)

### US3 — Community Mode Unchanged
- [ ] Choosing Community mode prompts for Supabase URL, Service Role Key, Qdrant URL, Qdrant API Key
- [ ] Community config includes `supabase_service_role_key` (unchanged)
- [ ] Community mode operations work identically to Phase 4

### US4 — Remove .hosted-env Dependency
- [ ] No `.hosted-env` file needed for hosted init
- [ ] No `VALIS_HOSTED_*` env vars needed
- [ ] `loadHostedEnv()` function removed from codebase
- [ ] `HOSTED_CREDENTIALS` constant removed from codebase
- [ ] No service_role key in any client-side code or config
- [ ] All existing tests pass (387+)
