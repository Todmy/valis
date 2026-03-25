# Quickstart: Phase 2 Validation

## Prerequisites

- Valis MVP installed and working (`valis status` shows OK)
- Supabase project with Realtime enabled
- Two machines/terminals with separate Valis sessions

## 1. Migrate to Per-Member Auth (US4)

```bash
# On machine A (admin)
valis migrate-auth
# Expected: "Migrated to per-member auth."

valis status
# Expected: Auth mode: jwt (per-member)
```

## 2. Decision Lifecycle (US1)

```bash
# Store a decision
valis search "database"
# → Should find existing decisions

# Via MCP tool in IDE session:
# valis_store({ text: "Use PostgreSQL for user data", type: "decision", affects: ["database"] })
# → stored

# Deprecate it:
# valis_lifecycle({ action: "deprecate", decision_id: "<id>", reason: "Switching to CockroachDB" })
# → deprecated, flagged_dependents shown

# Store replacement:
# valis_store({ text: "Use CockroachDB for user data", type: "decision", affects: ["database"], replaces: "<old_id>" })
# → stored, superseded info in response

valis search "database"
# → CockroachDB decision first, PostgreSQL labeled "superseded"
```

## 3. Cross-Session Push (US2)

```bash
# Terminal A: valis serve (running)
# Terminal B: valis serve (running, same org)

# In Terminal A's IDE session:
# valis_store({ text: "We chose gRPC for inter-service", type: "decision", affects: ["api"] })

# Terminal B should receive channel notification within 5 seconds:
# <channel source="valis" event="new_decision" author="olena" type="decision" origin="remote">
```

## 4. Contradiction Detection (US3)

```bash
# Store: "Use REST for external APIs" with affects: ["api"]
# Then store: "Use GraphQL for public API" with affects: ["api"]
# → Second store returns contradiction warning
# → Both sessions get contradiction notification

valis dashboard
# → Shows "Contradictions: 1 open"
```

## 5. Key Rotation (US4)

```bash
# Admin rotates a member's key
# POST /functions/v1/rotate-key { "rotate": "member_key", "target_member_id": "<id>" }
# → Old key immediately invalid

# Admin views audit trail
valis admin audit --limit 10
```

## 6. Metrics (US5)

```bash
valis admin metrics --period 7d
# → Shows active orgs, COGS, activation funnel
```

## Validation Checklist

- [ ] Per-member auth works (store, search, lifecycle)
- [ ] Legacy org-level key still works (backward compatible)
- [ ] Decision deprecation creates audit entry
- [ ] Supersede via `replaces` auto-transitions old decision
- [ ] Search ranks active above superseded
- [ ] Cross-session push delivers within 5 seconds
- [ ] Contradiction detection fires on area overlap
- [ ] Dashboard shows contradictions count
- [ ] Key rotation invalidates immediately
- [ ] Audit trail records all operations
- [ ] `valis admin metrics` shows correct data
- [ ] Realtime failure doesn't break store/search
