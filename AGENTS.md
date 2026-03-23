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

### Channel reminders
When you receive a `<channel source="teamind" event="capture_reminder">`, review your recent work and store any decisions made via `teamind_store`.
<!-- teamind:end -->
