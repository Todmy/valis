# Docker Container for Autonomous Claude Code

**Date**: 2026-03-22
**Status**: Approved

## Purpose

Docker container that runs Claude Code with `--dangerously-skip-permissions`
and `--channels plugin:telegram@claude-plugins-official` for autonomous
Valis MVP implementation. Isolated sandbox — destructive permissions
stay inside the container, code changes persist via mounted volume.

## Design

**Image**: `node:20-slim` + git, pnpm, claude-code (npm global), Supabase CLI.

**Volumes**:
- `~/.claude/` → `/root/.claude/` (auth, plugins, channels state)
- `.` → `/workspace` (repo — changes persist on host)
- `~/.gitconfig` → `/root/.gitconfig` (git identity for commits)

**Makefile targets**:
- `make build` — build image
- `make run` — interactive Claude Code with channels + skip-permissions
- `make run-task TASK="..."` — run with specific prompt
- `make shell` — bash inside container for debugging

**Not included**: Docker Compose, GPU, persistent node_modules volumes.

## Security Model

`--dangerously-skip-permissions` is sandboxed inside Docker. The container
can modify files in `/workspace` (mounted repo) but cannot access host
system beyond the mounted volumes. This is the intended use case —
autonomous agent work in an isolated environment.
