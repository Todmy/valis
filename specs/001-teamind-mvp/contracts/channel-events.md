# Channel Event Contracts: Teamind MVP

**Protocol**: MCP channel push (`notifications/claude/channel`)
**Requirement**: Claude Code v2.1.80+ with `--channels` flag
**Research source**: `docs/claude-code-channels-research.md`

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

## Implementation Constraints (from channels research)

**Server setup**:
- Declare capability: `{ experimental: { 'claude/channel': {} } }`
- Provide `instructions` string in Server constructor — injected into
  Claude's system prompt. Use to tell the agent what events to expect.
- Push via `mcp.notification({ method: 'notifications/claude/channel',
  params: { content, meta } })`
- `meta` keys MUST be identifiers only: `[a-z0-9_]`. Hyphens and
  special characters are silently dropped. Use `event`, `author`,
  `type` — not `event-type` or `decision-id`.

**Logging**:
- All server logging MUST use `console.error`. `console.log` writes
  to stdout which is reserved for MCP protocol — using it breaks
  the stdio transport.

**Development mode**:
- Custom (non-marketplace) channels require:
  `claude --dangerously-load-development-channels server:teamind`
- `teamind init` MUST configure this flag in Claude Code settings
  or document it as a manual step.
- Research preview only — when channels graduate to stable, switch
  to `--channels` flag.

**Enterprise/Team orgs**:
- `channelsEnabled` must be enabled in managed settings by org admin
  at `claude.ai → Admin settings → Claude Code → Channels`.
- If disabled, channel events are silently dropped. MCP tools still
  work (pull-based). Document this in `teamind status` output.

**Auth requirement**:
- Channels require claude.ai login. API key auth and Console auth
  are NOT supported. Document in README prerequisites.

**Known issues**:
- Bug #36800: Claude Code can spawn duplicate plugin instances
  mid-session, causing 409 Conflict and tool loss. Mitigation:
  handle gracefully — if MCP server detects duplicate startup,
  log warning and exit cleanly.

**Transport**: stdio only. Claude Code spawns the channel server as
a subprocess.
