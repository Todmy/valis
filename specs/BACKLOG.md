# Teamind Product Backlog

Items not yet specified. Ordered by strategic priority.

## Phase 4B: Go to Market

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| 1 | Annual prepay discount (20%) | 1-2 days | Not started |
| 2 | Pricing page / website | 3-5 days | Not started |
| 3 | Device Authorization Grant (RFC 8628) for dashboard auth | 2-3 days | Not started |

## Phase 5: Platform

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| 4 | **Task Marketplace** — project owners post tasks, external developers claim and execute them. Knowledge base controls which decisions the freelancer can see (via per-task access policy/prompt). KB validates submitted work against existing constraints. Simpler than Upwork — post task, wait for taker. Revenue: commission or premium. | Large | Idea |
| 5 | Selective Knowledge Sharing — per-task scoped access to decisions (subset of project knowledge). Owner defines a policy prompt: "share API conventions but not security architecture." | Medium | Idea (prerequisite for #4) |
| 6 | External member invites with task-scoped access | Medium | Idea (prerequisite for #4) |
| 7 | Validation pipeline — KB checks PR against existing decisions/constraints before merge | Medium | Idea |

## Technical Debt

| # | Item | Priority |
|---|------|----------|
| 8 | Delete `export-cmd.ts` (command unregistered, file is dead code) | Low |
| 9 | Golden test set — 50 query-result pairs for reranking NDCG evaluation | Medium |
| 10 | E2E tests per quickstart.md for each phase | Medium |
| 11 | Hosted mode Qdrant verification endpoint (`/functions/v1/verify-qdrant`) | Low |
| 12 | `hosted-env` approach fully deprecated — Registration API replaces it | Done (005) |

## Completed Phases

| Phase | Feature | Spec |
|-------|---------|------|
| 001 | MVP — CLI + MCP + dual storage | `specs/001-teamind-mvp/` |
| 002 | Retention & Enterprise — lifecycle, push, auth, RBAC | `specs/002-retention-enterprise/` |
| 003 | Search Intelligence & Growth — reranking, dashboard, enrichment, billing | `specs/003-search-growth/` |
| 004 | Multi-Project — project-scoped isolation | `specs/004-multi-project/` |
| 005 | Registration API — zero-config hosted onboarding | `specs/005-registration-api/` |
| — | Community Edition — Docker Compose self-hosted | `community/` |
