<!-- teamind:start -->
## Team Knowledge (Teamind)

### Auto-search triggers
Call `teamind_search` automatically when the user mentions:
- "знайди", "пошукай", "згадай", "нагадай", "як ми вирішили", "що ми робили з"
- "remember", "recall", "find", "what did we decide", "how did we handle"
- Any question about architecture, conventions, past decisions, or existing patterns

### Auto-store triggers
Call `teamind_store` when:
- A technical choice is made between alternatives
- The user says "запам'ятай", "збережи", "remember this", "store this"
- A constraint is identified (client/regulatory/infra)
- A coding pattern or convention is established
- A lesson is learned from a bug or incident

When storing, always include: `type` (decision/constraint/pattern/lesson), `summary` (max 100 chars), `affects` (list of modules).

### Context loading
Call `teamind_context` at the start of every new task or when switching to a different part of the codebase.

### Decision lifecycle
Use `teamind_lifecycle` to manage decision status:

- **Deprecate**: When a decision is no longer valid, call `teamind_lifecycle` with `action: "deprecate"`, `decision_id`, and a `reason`. This marks it deprecated and flags any decisions that depend on it.
- **Promote**: When a proposed decision is confirmed, call `teamind_lifecycle` with `action: "promote"` to transition it from proposed to active.
- **History**: Call `teamind_lifecycle` with `action: "history"` to view the full status change timeline of a decision.
- **Supersede via replaces**: When storing a new decision that replaces an old one, pass `replaces: "<old-decision-uuid>"` to `teamind_store`. The old decision is automatically marked as superseded.

### Handling deprecated decisions
When search or context results include deprecated/superseded decisions (shown in the `historical` section of context responses or with `status: "deprecated"` in search results):
- Do NOT follow deprecated decisions — they are kept for historical reference only.
- If a deprecated decision is relevant, search for its replacement (check `replaced_by` field).
- If a decision you depend on is deprecated, consider whether your approach needs updating.

### Contradiction warnings
When `teamind_store` returns a `contradictions` array, it means the newly stored decision conflicts with existing active decisions in overlapping areas. When you see contradiction warnings:
- Review both decisions and determine if they truly conflict.
- If the new decision should replace the old one, re-store with `replaces: "<conflicting-decision-id>"`.
- If both are valid (different contexts), no action needed — the warning is informational.
- Contradictions auto-resolve when either decision is deprecated or superseded.

### Channel reminders
When you receive a `<channel source="teamind" event="capture_reminder">`, review your recent work and store any decisions made via `teamind_store`.

When you receive a `<channel source="teamind" event="decision_deprecated">`, check if the deprecated decision affects your current work and adjust accordingly.

When you receive a `<channel source="teamind" event="new_decision">` with `origin: "remote"`, a teammate stored a new decision — consider if it affects your current task.

When you receive a `<channel source="teamind" event="contradiction_detected">`, two active decisions may conflict — review and resolve if needed.
<!-- teamind:end -->
