# MCP Tool Contract Changes: Phase 2

Extends `/specs/001-teamind-mvp/contracts/mcp-tools.md`.

## teamind_store (extended)

New optional parameters:

```typescript
interface StoreArgs {
  // Existing (unchanged)
  text: string;
  type?: 'decision' | 'constraint' | 'pattern' | 'lesson';
  summary?: string;
  affects?: string[];
  confidence?: number;
  project_id?: string;
  session_id?: string;

  // Phase 2 additions
  replaces?: string;      // UUID of decision being replaced
  depends_on?: string[];   // UUIDs of dependency decisions
  status?: 'active' | 'proposed';  // default: 'active'
}
```

**Extended response**:

```json
{
  "id": "uuid",
  "status": "stored",
  "synced": true,
  "contradictions": [
    {
      "decision_id": "uuid",
      "summary": "Use REST for all APIs",
      "author": "Olena",
      "overlap_areas": ["api"],
      "similarity": 0.85
    }
  ],
  "superseded": {
    "decision_id": "uuid",
    "old_status": "active",
    "new_status": "superseded"
  }
}
```

**New behaviors**:
1. If `replaces` provided: validate target exists, transition to
   superseded, include `superseded` in response
2. If `depends_on` provided: validate all IDs exist in same org
3. After successful store: run contradiction detection against active
   decisions with overlapping `affects`
4. If contradictions found: include in response as warnings (store
   succeeds regardless)
5. Push contradiction events via cross-session push

## teamind_search (extended)

Search results now include status information:

```json
{
  "results": [
    {
      "id": "uuid",
      "score": 0.95,
      "type": "decision",
      "summary": "Use gRPC for inter-service",
      "detail": "...",
      "author": "Andriy",
      "status": "active",
      "replaced": null,
      "replaced_by": null,
      "affects": ["api", "architecture"],
      "created_at": "2026-03-23T10:00:00Z"
    },
    {
      "id": "uuid",
      "score": 0.80,
      "type": "decision",
      "summary": "Use REST for all APIs",
      "detail": "...",
      "author": "Olena",
      "status": "superseded",
      "replaced_by": "uuid-of-grpc-decision",
      "affects": ["api"],
      "created_at": "2026-03-20T10:00:00Z"
    }
  ]
}
```

**Ranking change**: Active decisions ranked above deprecated/superseded
at equal relevance scores. Status label included in all results.

## teamind_lifecycle (new tool)

Manage decision status from MCP context.

```typescript
interface LifecycleArgs {
  action: 'deprecate' | 'promote' | 'history';
  decision_id: string;
  reason?: string;
}
```

**Response (deprecate/promote)**:

```json
{
  "decision_id": "uuid",
  "old_status": "active",
  "new_status": "deprecated",
  "changed_by": "Olena",
  "flagged_dependents": ["uuid1"]
}
```

**Response (history)**:

```json
{
  "decision_id": "uuid",
  "current_status": "deprecated",
  "history": [
    {
      "from": "active",
      "to": "deprecated",
      "by": "Olena",
      "reason": "Replaced by gRPC",
      "at": "2026-03-23T10:00:00Z"
    }
  ]
}
```

**Note**: `supersede` is not an action here — it happens via
`teamind_store` with `replaces` parameter. Direct status change to
`superseded` without a replacement is not allowed.
