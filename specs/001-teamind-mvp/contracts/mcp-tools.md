# MCP Tool Contracts: Teamind MVP

**Transport**: stdio
**Capabilities**: `{ tools: {}, experimental: { 'claude/channel': {} } }`

## teamind_store

Store a team decision into the shared team brain.

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "minLength": 10,
      "description": "Full decision text"
    },
    "type": {
      "type": "string",
      "enum": ["decision", "constraint", "pattern", "lesson"],
      "description": "Decision classification (optional). If omitted, server stores as type 'pending'"
    },
    "summary": {
      "type": "string",
      "maxLength": 100,
      "description": "Brief summary (optional)"
    },
    "affects": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Affected areas, e.g. ['auth', 'payments']"
    },
    "confidence": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10,
      "description": "Confidence score (optional, 1-10)"
    },
    "project_id": {
      "type": "string",
      "description": "Project directory name (optional, auto-detected from cwd)"
    },
    "session_id": {
      "type": "string",
      "description": "Session UUID for cross-layer dedup (optional, auto-detected)"
    }
  },
  "required": ["text"]
}
```

**Processing pipeline**:
1. Validate input (min 10 chars)
2. Secret detection (10 patterns) → block if match
3. Content hash + session_id dedup → skip if duplicate
4. Dual write: INSERT Postgres + UPSERT Qdrant
5. If offline: queue to `~/.teamind/pending.jsonl`
6. Channel push: notify other active sessions

**Success response**: `{ "id": "uuid", "status": "stored" }`
**Offline response**: `{ "id": "uuid", "stored": true, "synced": false }`
**Secret blocked**: `{ "error": "secret_detected", "pattern": "Anthropic API Key", "action": "blocked" }`
**Duplicate**: `{ "id": "existing-uuid", "status": "duplicate" }`

**Latency target**: <200ms (cloud), <10ms (offline queue)

## teamind_search

Search the team's shared decision history.

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1,
      "description": "Search query text"
    },
    "type": {
      "type": "string",
      "enum": ["decision", "constraint", "pattern", "lesson"],
      "description": "Filter by type (optional)"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 50,
      "default": 10,
      "description": "Max results to return"
    }
  },
  "required": ["query"]
}
```

**Processing pipeline**:
1. Validate input
2. Qdrant hybrid search: dense + BM25 sparse + org_id filter
3. Apply optional type filter
4. Return ranked results

**Success response**:

```json
{
  "results": [
    {
      "id": "uuid",
      "score": 0.87,
      "type": "decision",
      "summary": "Chose PostgreSQL for user data",
      "detail": "We chose PostgreSQL because...",
      "author": "olena",
      "affects": ["database", "user-service"],
      "created_at": "2026-03-20T14:30:00Z"
    }
  ]
}
```

**Offline response**: `{ "results": [], "offline": true, "note": "Cloud unavailable. Search offline." }`

## teamind_context

Load relevant team decisions for the current task.

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "task_description": {
      "type": "string",
      "minLength": 1,
      "description": "What the developer is working on"
    },
    "files": {
      "type": "array",
      "items": { "type": "string" },
      "description": "File paths being worked on (optional)"
    }
  },
  "required": ["task_description"]
}
```

**Processing pipeline**:
1. Build search query from task_description + file names
2. Qdrant hybrid search with org_id filter
3. Group results by type
4. If first call in session: prepend orientation note

**Success response**:

```json
{
  "decisions": [...],
  "constraints": [...],
  "patterns": [...],
  "lessons": [...],
  "total_in_brain": 47,
  "note": "47 total decisions in team brain. Use teamind_search for specific queries."
}
```

**Offline response**: `{ "decisions": [], "constraints": [], "patterns": [], "lessons": [], "offline": true }`
