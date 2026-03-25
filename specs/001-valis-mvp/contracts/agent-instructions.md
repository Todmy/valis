# Agent Instructions Contract: Valis MVP

**Source**: design-spec-v5.md § 4 "What the injected instructions tell agents"
**Injected by**: `valis init` → T020 (CLAUDE.md/AGENTS.md marker injection)

## Exact Injection Content

This text is placed between `<!-- valis:start -->` and `<!-- valis:end -->`
markers in CLAUDE.md and AGENTS.md:

```markdown
## Team Knowledge (Valis)

### Auto-search triggers
Call `valis_search` automatically when the user mentions:
- "знайди", "пошукай", "згадай", "нагадай", "як ми вирішили", "що ми робили з"
- "remember", "recall", "find", "what did we decide", "how did we handle"
- Any question about architecture, conventions, past decisions, or existing patterns

### Auto-store triggers
Call `valis_store` when:
- A technical choice is made between alternatives
- The user says "запам'ятай", "збережи", "remember this", "store this"
- A constraint is identified (client/regulatory/infra)
- A coding pattern or convention is established
- A lesson is learned from a bug or incident

When storing, always include: `type` (decision/constraint/pattern/lesson), `summary` (max 100 chars), `affects` (list of modules).

### Context loading
Call `valis_context` at the start of every new task or when switching to a different part of the codebase.

### Channel reminders
When you receive a `<channel source="valis" event="capture_reminder">`, review your recent work and store any decisions made via `valis_store`.
```

## Marker Rules

- No config file exists → create project-level file with valis block
- File exists in project → append between markers
- File exists in parent only → create NEW project-level, never modify parent
- Markers already exist → replace content between markers (idempotent)
