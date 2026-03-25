# CLI Command Contracts: Valis MVP

**Binary**: `valis`
**Install**: `npm install -g valis`

## valis init

Create or join an organization and configure the local environment.

```
valis init [--join <invite-code>]
```

**Create flow** (no flags):
1. Prompt: org name
2. Call Edge Function `create-org` → returns org_id, api_key, invite_code
3. Save to `~/.valis/config.json` (0600)
4. Auto-detect IDEs (Claude Code, Codex)
5. Configure MCP server for each IDE
6. Inject CLAUDE.md / AGENTS.md instruction markers
7. Set cleanupPeriodDays: 99999 (Claude Code)
8. Run seed extraction (CLAUDE.md, AGENTS.md, git log)
9. Verification: store + search round-trip
10. Print invite code + next steps

**Join flow** (`--join ACME-7X3K`):
1. Call Edge Function `join-org` → validates invite, returns org context
2. Steps 3-7 same as create
3. Skip seed (org already has data)
4. Print: "N decisions already available"

**Exit codes**: 0 = success, 1 = error (with actionable message)

## valis serve

Start the unified MCP + Channel server process.

```
valis serve
```

1. Load config from `~/.valis/config.json`
2. Run startup sweep (async, non-blocking)
3. Start JSONL activity watcher (background)
4. Start stop hook HTTP handler (background, localhost, random port)
5. Start MCP server (blocks — stdio event loop)
6. On exit: save watcher state, cleanup

**Note**: This is the entry point the IDE launches as an MCP server subprocess.

## valis status

Show system health and org info.

```
valis status
```

**Output**:
- Cloud: ● Connected / ○ Degraded / ✕ Offline
- Org: {name} ({member_count} members)
- Decisions: {count} ({pending_count} pending enrichment)
- Queue: {pending_sync_count} awaiting sync
- IDEs: Claude Code ✓, Codex ✓

**Latency target**: <2 seconds

## valis dashboard

Show aggregated team activity.

```
valis dashboard
```

**Output** (colored terminal):
- Total decisions: N
- By type: decision (N), constraint (N), pattern (N), lesson (N)
- By author: {name} (N), ...
- Recent 5: {summary} — {author} — {date}
- Pending: N decisions awaiting classification

## valis search

Search decisions from the terminal.

```
valis search <query> [--type <type>] [--limit <n>]
```

**Output**: Formatted table with score, type, summary, author, date.

## valis export

Export all org decisions.

```
valis export --json [--output <file>]
valis export --markdown [--output <file>]
```

**Defaults**: stdout (pipe-friendly). `--output` writes to file.

## valis config

Manage configuration.

```
valis config set <key> <value>
valis config get <key>
```

**Keys**: api-key (masked on get), author-name, org-id (read-only).

## valis uninstall

Remove all local Valis configuration.

```
valis uninstall [--yes]
```

1. Confirm (skip with `--yes`)
2. Read `~/.valis/manifest.json`
3. Remove MCP configs from each IDE (surgical JSON edit)
4. Remove CLAUDE.md / AGENTS.md markers
5. Remove hook configs
6. Delete `~/.valis/`
7. Print: "Cloud data preserved. Contact org admin to delete."
