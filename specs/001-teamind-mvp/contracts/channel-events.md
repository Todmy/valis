# Channel Event Contracts: Teamind MVP

**Protocol**: MCP channel push (`notifications/claude/channel`)
**Requirement**: Claude Code v2.1.80+ with `--channels` flag

## capture_reminder

Sent by Teamind to the agent when significant activity is detected.
The agent should review recent work and store decisions.

**Trigger**: JSONL watcher detects 15+ minutes of activity, or stop
hook fires (session end).

**Payload**:

```xml
<channel source="teamind" event="capture_reminder">
Review your recent work. If any decisions, constraints, patterns,
or lessons were established, store them via teamind_store with type,
summary, and affects.
</channel>
```

**Agent expected action**: Call `teamind_store` for each decision found.

## new_decision

Sent to all active sessions in the same org when a decision is stored.

**Trigger**: Any successful `teamind_store` (explicit or auto-capture).

**Payload**:

```xml
<channel source="teamind" event="new_decision" author="olena" type="decision">
Chose PostgreSQL over MongoDB for user data — need ACID for
payment transactions
</channel>
```

**Agent expected action**: Incorporate into current context. No action
required — informational only.

## Delivery Guarantees

- Channel events are NOT buffered — only delivered to active sessions.
- If a session doesn't have channel support, it works normally via
  pull-based tools (`teamind_search`, `teamind_context`).
- Push is supplementary to pull. No data is lost if push fails.
- Channel push requires the MCP server to track connected sessions.
  For MVP, the MCP server pushes to local channel only (its own
  session). Cross-session push (Dev A → Dev B) requires Supabase
  Realtime or polling — scoped for later in MVP if time permits.
