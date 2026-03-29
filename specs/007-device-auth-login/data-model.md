# Data Model: Device Authorization Login

**Feature**: 007-device-auth-login

## Migration 008: Add Member Email + Device Codes

### Modified Entity: members

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| email | TEXT | UNIQUE, nullable | Links to Supabase Auth identity. Set during registration. |

### New Entity: device_codes

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PK, DEFAULT gen_random_uuid() | |
| user_code | TEXT | UNIQUE, NOT NULL | Human-readable, e.g. "ABCD-1234" |
| device_code | TEXT | UNIQUE, NOT NULL | Secret UUID, used by CLI for polling |
| member_id | UUID | FK → members(id), nullable | Filled on approval |
| member_api_key | TEXT | nullable | Copied from members.api_key on approval |
| status | TEXT | NOT NULL, DEFAULT 'pending' | CHECK: pending, approved, expired, denied |
| expires_at | TIMESTAMPTZ | NOT NULL | created_at + 15 minutes |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | |
| ip_address | TEXT | nullable | For rate limiting (3/IP/hour) |

### State Transitions: device_codes.status

```
pending → approved   (user clicks Approve on dashboard)
pending → denied     (user clicks Deny on dashboard)
pending → expired    (15 minutes elapsed, checked on poll)
```

No transitions FROM approved/denied/expired — these are terminal states.

### Relationships

```
orgs 1──N members 1──N device_codes
                  │
                  └── email ←→ Supabase Auth (auth.users.email)
```

### Indexes

- `device_codes(user_code)` — UNIQUE (lookup by human-readable code)
- `device_codes(device_code)` — UNIQUE (lookup by CLI polling secret)
- `device_codes(ip_address, created_at)` — for rate limiting query
- `members(email)` — UNIQUE (lookup by Supabase Auth email)

### Cleanup

Expired device codes should be cleaned up periodically. Options:
- Postgres cron job: `DELETE FROM device_codes WHERE expires_at < now() - interval '1 day'`
- Or let them accumulate — low volume (3/IP/hour max)
