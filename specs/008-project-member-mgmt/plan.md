# Implementation Plan: Web Project Member Management

**Branch**: `008-project-member-mgmt` | **Date**: 2026-03-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-project-member-mgmt/spec.md`

## Summary

Add project detail page with member management: view members, invite by email (with email notification via Resend), remove members. Admin-only actions enforced server-side.

## Technical Context

**Language/Version**: TypeScript (ES2022, NodeNext), Node.js 20+
**Primary Dependencies**: `@supabase/ssr` (browser client), `next` (App Router), `resend` (email sending — NEW)
**Storage**: Supabase Postgres (existing tables: projects, project_members, members)
**Testing**: Vitest (101 web tests)
**Target Platform**: Web dashboard (Vercel) at valis.krukit.co
**Project Type**: Web monorepo (packages/web)
**Performance Goals**: Member list loads < 2s for 100 members. Invite completes < 30s.
**Constraints**: Resend free tier 100 emails/day. Rate limit 10 invites/hour/project.
**Scale/Scope**: 2 API endpoints, 1 dashboard page, 1 npm package install. No migrations.

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Cloud-First | PASS | Web dashboard, cloud data |
| II. Minimally Invasive | PASS | Dashboard page only, no IDE changes |
| III. Non-Blocking | PASS | Email failure doesn't block invite |
| IV. No LLM Dependency | PASS | No LLM calls |
| V. Zero Native Dependencies | PASS | `resend` is pure JS |
| VI. Auto-Capture | N/A | Not a capture feature |
| VII. Dual Storage | N/A | No Qdrant involved |
| VIII. Push + Pull | N/A | Dashboard feature |
| IX. Decision Lifecycle | N/A | Member management |
| X. Identity-First Access | PASS | Admin role enforced for invite/remove |
| XI. Project-Scoped Isolation | PASS | Members scoped to specific project |
| Security | PASS | Server-side permission checks, rate limiting |
| Dev Workflow | PASS | No migrations needed, existing tables sufficient |

**All gates pass. No violations.**

## Project Structure

### Documentation

```text
specs/008-project-member-mgmt/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api-endpoints.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
packages/web/
├── src/app/
│   ├── projects/
│   │   └── [id]/
│   │       └── page.tsx          # NEW: project detail page
│   └── api/
│       ├── invite-member/
│       │   └── route.ts          # NEW: invite by email
│       └── remove-member/
│           └── route.ts          # NEW: remove from project
├── src/lib/
│   └── resend.ts                 # NEW: Resend client singleton
└── package.json                  # MODIFIED: add resend dependency
```

**Structure Decision**: Minimal addition — 1 page, 2 API routes, 1 utility. No migrations. Uses existing `useDashboardAuth()` and Supabase browser client patterns.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
