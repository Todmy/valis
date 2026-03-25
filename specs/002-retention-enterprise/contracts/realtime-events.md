# Realtime Event Contracts: Phase 2

## Architecture

```
Decision stored (Supabase INSERT)
  → Supabase Realtime (postgres_changes)
  → MCP server subscribes per org_id
  → Channel push to local IDE session
```

Each `valis serve` process subscribes to:
```typescript
supabase.channel(`org:${orgId}`).on('postgres_changes', {
  event: 'INSERT',
  schema: 'public',
  table: 'decisions',
  filter: `org_id=eq.${orgId}`,
}, handler)
```

## Event: New Decision (cross-session)

**Trigger**: INSERT on `decisions` table (any source).

**Payload** (from Supabase Realtime `payload.new`):
- id, org_id, type, summary, detail, author, affects, created_at

**Channel push** (to local IDE session):

```xml
<channel source="valis" event="new_decision" author="andriy" type="decision" origin="remote">
Use gRPC for inter-service communication — better performance
for high-throughput internal APIs
</channel>
```

**`origin: remote`** distinguishes cross-session push from local
push. Local decisions (stored by this session) already have local
push via the existing MVP channel event.

**Dedup**: If the decision was stored by THIS session (author matches
local config author_name + timestamp within 5s), skip the push to
avoid duplicate notifications.

## Event: Contradiction Detected

**Trigger**: Contradiction detection in store pipeline finds conflict.

**Channel push**:

```xml
<channel source="valis" event="contradiction_detected" author="andriy" type="warning">
Potential contradiction: "Use GraphQL for public API" by Andriy
conflicts with "Use REST for all APIs" by Olena (area: api).
Both remain active — resolve via deprecation or replacement.
</channel>
```

## Event: Decision Deprecated (cross-session)

**Trigger**: UPDATE on `decisions` where `status` changes to
`deprecated` or `superseded`.

**Implementation**: Subscribe to UPDATE events as well:
```typescript
supabase.channel(`org:${orgId}`).on('postgres_changes', {
  event: 'UPDATE',
  schema: 'public',
  table: 'decisions',
  filter: `org_id=eq.${orgId}`,
}, handler)
```

**Channel push**:

```xml
<channel source="valis" event="decision_deprecated" author="olena" type="info">
Decision deprecated by Olena: "Use REST for all APIs"
Reason: Replaced by gRPC decision
</channel>
```

## Event: Dependency Flagged

**Trigger**: A decision with `depends_on` references has a dependency
deprecated.

**Channel push**:

```xml
<channel source="valis" event="dependency_flagged" author="system" type="warning">
Decision "Caching strategy uses Redis" may need review —
its dependency "Use PostgreSQL for user data" was deprecated.
</channel>
```

## Connection Lifecycle

1. On `valis serve` startup: subscribe to org channel
2. On Realtime disconnect: log warning, pull-based tools continue
3. On reconnect: resubscribe automatically (supabase-js handles this)
4. On `valis serve` exit: unsubscribe, close channel
5. No message buffering — missed events recovered via search

## Tenant Isolation

- Realtime subscription uses `filter: org_id=eq.${orgId}` (pre-filter)
- RLS policies enforce org isolation at DB level (post-filter)
- Both layers must pass — defense in depth
