# Research: Device Authorization Login

**Feature**: 007-device-auth-login
**Date**: 2026-03-29

## Decision 1: Email-to-Member Linking

**Decision**: Add `email TEXT UNIQUE` column to `members` table. Dashboard auth matches Supabase Auth email → `members.email`.

**Rationale**: Simplest approach. One lookup. No extra tables. Members table already has unique constraint on `(org_id, author_name)` — email adds another identity axis.

**Alternatives considered**:
- Separate `auth_links` mapping table — over-engineered for MVP, useful later for OAuth providers
- No schema change, resolve via auth session → org → member name lookup — fragile, name collisions possible

**Migration**: `008_add_member_email.sql` — `ALTER TABLE members ADD COLUMN email TEXT UNIQUE;`

## Decision 2: Supabase Auth Integration

**Decision**: Use Supabase Auth `signInWithOtp({ email })` for dashboard magic link login. Supabase Auth is already available (free tier) but NOT currently used — dashboard uses API key auth via `AuthGate`.

**Rationale**: Supabase Auth handles email delivery, rate limiting, token management, session persistence. No need to build custom email auth.

**Key findings**:
- Dashboard currently uses custom API key auth (`tmm_` → JWT exchange)
- `AuthGate` component shows login form for API key
- Supabase Auth session is separate from Valis JWT — they coexist
- Dashboard will need TWO auth layers: Supabase Auth (for magic link login) + Valis member lookup (for device approval)

**Alternatives considered**:
- Custom magic link implementation — reinventing the wheel, Supabase does this already
- OTP code via email — same infrastructure as magic link but worse UX

## Decision 3: Device Code Storage

**Decision**: New `device_codes` table in Supabase. CLI generates request → server creates code → CLI polls → dashboard user approves.

**Rationale**: Server-side storage ensures codes are validated atomically. Client-side storage (localStorage) wouldn't work for cross-device flow.

**Table design**:
```
device_codes (
  id UUID PK,
  user_code TEXT UNIQUE NOT NULL,       -- "ABCD-1234" (human-readable)
  device_code TEXT UNIQUE NOT NULL,     -- UUID (secret, for CLI polling)
  member_id UUID REFERENCES members,   -- filled on approval
  member_api_key TEXT,                  -- filled on approval
  status TEXT DEFAULT 'pending',        -- pending|approved|expired|denied
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  ip_address TEXT                       -- for rate limiting
)
```

## Decision 4: Dashboard Auth Architecture

**Decision**: Keep existing `AuthGate` (API key) for backward compatibility. Add new Supabase Auth flow for `/auth/*` pages only. Device approval page uses Supabase Auth session.

**Rationale**: Can't break existing dashboard users who log in with API key. New auth pages are additive.

**Flow on dashboard**:
1. `/auth/login` — Supabase Auth magic link (new page)
2. `/auth/device?code=XXXX` — requires Supabase Auth session (new page)
3. `/dashboard`, `/decisions`, etc. — still use API key auth via existing `AuthGate`

Later: migrate all dashboard pages to Supabase Auth.

## Decision 5: CLI Browser Opening

**Decision**: Use Node.js `child_process.execFile` with platform detection: `open` (macOS), `xdg-open` (Linux), `start` (Windows). Use `execFile` not `exec` to prevent shell injection.

**Rationale**: No npm dependency needed. Standard approach used by `gh auth login`, `vercel login`, `claude` CLI. `execFile` is safer than `exec` — no shell interpretation.

## Decision 6: Registration Email Collection

**Decision**: Add `email` field to `POST /api/register` request. Store in `members.email`. Create Supabase Auth user via `supabase.auth.admin.createUser({ email })`.

**Rationale**: Links Valis member to Supabase Auth identity at registration time. User can then use magic link login on dashboard.

**Key detail**: `createUser` (admin API) creates the user without sending a confirmation email. The magic link email is only sent when user initiates login.

## Decision 7: Default Email Sender

**Decision**: Use default Supabase Auth sender (`noreply@mail.app.supabase.io`) for MVP. Custom SMTP (e.g. `noreply@krukit.co`) deferred to backlog #30.

**Rationale**: Custom SMTP requires DNS SPF/DKIM setup. For dog-fooding with a few developers, default sender is sufficient.
