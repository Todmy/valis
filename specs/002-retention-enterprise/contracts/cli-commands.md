# CLI Command Contract Changes: Phase 2

Extends `/specs/001-valis-mvp/contracts/cli-commands.md`.

## valis admin metrics

Platform operator command. Requires `service_role` key (not
per-member auth).

```
valis admin metrics [--json] [--period 7d|30d]
```

**Output (table)**:

```
Valis Metrics (last 7 days)
─────────────────────────────
Total orgs:         12
Active orgs (7d):   8  (67%)
Active orgs (30d):  10 (83%)

Avg decisions/org:  45
Avg searches/org:   120
Est. COGS/org/mo:   $0.85

Activation Funnel
  Created:          12
  First store <24h: 9   (75%)
  Weekly active:    8   (67%)

At-risk (30d idle): 2
  - Org "Beta Team" (last activity: 2026-02-15)
  - Org "Demo Org" (last activity: 2026-02-20)
```

**Output (json)**: Same data as JSON object.

**Auth**: Uses `SUPABASE_SERVICE_ROLE_KEY` from config or env.
Does NOT use per-member JWT — this is a platform operator command.

## valis admin audit

View audit trail for an org.

```
valis admin audit [--org ORG_ID] [--member AUTHOR] [--limit 50]
```

**Output**:

```
Audit Trail — Acme Engineering
───────────────────────────────
2026-03-23 10:15 Olena   decision_deprecated  #47 "Use REST for APIs"
                         reason: "Replaced by gRPC decision"
2026-03-23 10:14 Andriy  decision_stored      #52 "Use gRPC for inter-service"
                         replaces: #47
2026-03-23 09:00 Olena   member_joined         Andriy (member)
```

## valis dashboard (extended)

New sections in dashboard output:

```
Contradictions: 2 open
  #47 "Use REST" ↔ #52 "Use GraphQL"  (area: api)
  #33 "Use Redis" ↔ #38 "Use Memcached" (area: caching)

Lifecycle:
  Active: 42  Deprecated: 5  Superseded: 3  Proposed: 0
```

## valis status (extended)

New fields:

```
Auth mode:     jwt (per-member)
Realtime:      connected (push active)
Member key:    tmm_****abcd
```

## valis migrate-auth

One-time migration from org-level to per-member auth.

```
valis migrate-auth
```

**Flow**:
1. Verify current auth is legacy (org-level key)
2. Call exchange-token to get JWT
3. Update local config with `auth_mode: 'jwt'`
4. Test round-trip with new auth
5. Print: "Migrated to per-member auth. Org-level key still works
   for other members until admin disables it."
