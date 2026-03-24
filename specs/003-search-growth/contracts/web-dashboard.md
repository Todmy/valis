# Contract: Web Dashboard

**Phase**: 1 — Design & Contracts
**Date**: 2026-03-24
**Implements**: FR-005, FR-006

## Overview

Read-only web dashboard for Engineering Managers and Tech Leads to
browse the team brain without CLI access. Hosted on Vercel, powered
by Next.js (React), authenticated via existing API key -> JWT
exchange, querying Supabase directly with JWT-enforced RLS.

## Repository Structure

```
packages/web/
├── package.json             # Next.js + @supabase/supabase-js + tailwindcss
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx       # Root layout with auth provider
│   │   ├── page.tsx         # Landing/login page
│   │   ├── decisions/
│   │   │   └── page.tsx     # Decision list with search and filters
│   │   ├── search/
│   │   │   └── page.tsx     # Full search interface
│   │   ├── dashboard/
│   │   │   └── page.tsx     # Stats, activity timeline, usage metrics
│   │   ├── contradictions/
│   │   │   └── page.tsx     # Open contradictions view
│   │   └── proposed/
│   │       └── page.tsx     # Proposed decisions queue
│   ├── components/
│   │   ├── auth-gate.tsx    # API key entry + token exchange
│   │   ├── decision-card.tsx
│   │   ├── search-bar.tsx
│   │   ├── status-badge.tsx # active/proposed/deprecated/superseded labels
│   │   ├── pin-badge.tsx    # Pinned indicator
│   │   ├── stats-grid.tsx
│   │   ├── activity-timeline.tsx
│   │   ├── contradiction-pair.tsx
│   │   └── nav.tsx
│   ├── lib/
│   │   ├── supabase.ts      # Supabase client factory with JWT
│   │   ├── auth.ts          # Token exchange + refresh logic
│   │   └── types.ts         # Re-export from @teamind/cli types
│   └── hooks/
│       ├── use-auth.ts      # Auth context hook
│       ├── use-decisions.ts # Decision list query hook
│       └── use-stats.ts     # Dashboard stats query hook
└── tests/
    ├── auth.test.ts
    └── components/
```

## Authentication Flow

### Step 1: API Key Entry

The landing page presents an API key input field. The user enters
their member API key (`tmm_...`) or org API key (`tm_...`).

### Step 2: Token Exchange

```typescript
async function exchangeToken(apiKey: string): Promise<AuthSession> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/exchange-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new AuthError('Invalid API key');
  }

  const data: ExchangeTokenResponse = await response.json();
  return {
    jwt: data.token,
    expiresAt: new Date(data.expires_at),
    memberId: data.member_id,
    orgId: data.org_id,
    orgName: data.org_name,
    role: data.role,
    authorName: data.author_name,
  };
}
```

### Step 3: Supabase Client with JWT

```typescript
function createAuthenticatedClient(session: AuthSession) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => {
        // Refresh if within 5 minutes of expiry
        if (isExpiringSoon(session.expiresAt)) {
          session = await refreshToken(session);
        }
        return session.jwt;
      },
    },
  );
}
```

### Step 4: Token Refresh

JWT tokens expire after 1 hour. The dashboard refreshes automatically:

```typescript
async function refreshToken(session: AuthSession): Promise<AuthSession> {
  // Re-exchange using the stored API key
  // API key is stored in sessionStorage (not localStorage for security)
  const apiKey = sessionStorage.getItem('teamind_api_key');
  if (!apiKey) throw new AuthError('Session expired. Please re-enter your API key.');
  return exchangeToken(apiKey);
}
```

### Security Notes

- API key is stored in `sessionStorage` (cleared on tab close).
- JWT is held in memory only (never persisted to storage).
- All queries go through Supabase with JWT — RLS enforces tenant
  isolation at the database level.
- No `service_role` key is ever exposed to the browser.

## Pages

### /decisions — Decision List

**Data source**: `supabase.from('decisions').select('*').order('created_at', { ascending: false })`

**Features**:
- Paginated list (20 per page) with infinite scroll.
- Filter by: status (active/proposed/deprecated/superseded), type
  (decision/constraint/pattern/lesson/pending), author, affects area.
- Sort by: created_at, updated_at, confidence.
- Each card shows: summary, type badge, status badge, author, date,
  affects tags, pinned indicator.
- Click to expand: full detail text, depends_on links, replaces link,
  lifecycle history.

**Read-only**: No edit, delete, promote, deprecate, or pin buttons.
Those actions happen through CLI or MCP tools.

### /search — Search Interface

**Data source**: Uses existing Supabase RPC functions that mirror the
CLI search pipeline (including reranking and suppression when Phase 3
is deployed).

```typescript
const { data } = await supabase.rpc('search_decisions', {
  p_query: query,
  p_type: typeFilter,
  p_limit: limit,
});
```

If no RPC exists yet, falls back to client-side filtering:
```typescript
const { data } = await supabase
  .from('decisions')
  .select('*')
  .eq('status', 'active')
  .textSearch('detail', query)
  .limit(limit);
```

**Features**:
- Search bar with type-ahead.
- Results show composite score (when available) and signal breakdown.
- Suppressed results hidden by default, toggle to show all.
- Results match CLI search quality and ordering.

### /dashboard — Stats & Activity

**Data sources**:
- Decision counts by type, status, author: `supabase.from('decisions').select('type, status, author', { count: 'exact' })`
- Recent activity: `supabase.from('audit_entries').select('*').order('created_at', { ascending: false }).limit(50)`
- Usage metrics: `supabase.from('rate_limits').select('*')`
- Subscription info: `supabase.from('subscriptions').select('*').single()`

**Widgets**:
- Total decisions counter with sparkline trend.
- Breakdown by type (pie chart or bar chart).
- Breakdown by status (pie chart).
- Team activity timeline (recent audit entries).
- Usage quota bar (decisions used / limit, searches used / limit).
- Proposed decisions count (links to /proposed).
- Open contradictions count (links to /contradictions).

### /contradictions — Contradiction View

**Data source**: `supabase.from('contradictions').select('*, decision_a:decisions!decision_a_id(*), decision_b:decisions!decision_b_id(*)').eq('status', 'open')`

**Features**:
- List of open contradictions.
- Each shows: both decisions side-by-side, overlap areas highlighted,
  similarity score, detected_at date.
- Resolution status indicator (all are open — resolved ones filtered out).

**Read-only**: No "Resolve" button. Resolution happens through CLI
(`teamind dismiss-contradiction` or by deprecating one of the decisions).

### /proposed — Proposed Queue

**Data source**: `supabase.from('decisions').select('*').eq('status', 'proposed').order('created_at', { ascending: false })`

**Features**:
- List of proposed decisions awaiting review.
- Each shows: summary, author, date, affects areas.
- Count badge in navigation: "Proposed (N)".

**Read-only**: No "Approve" or "Reject" buttons. Promotion/deprecation
happens through CLI or MCP `teamind_lifecycle` tool.

## Tenant Isolation

All data access flows through Supabase with a JWT containing the
`org_id` claim. RLS policies on every table enforce that:

```sql
USING (org_id::text = (select auth.jwt()->>'org_id'))
```

The dashboard cannot access data from other orgs, even if the user
modifies client-side code. The JWT is minted server-side by the
exchange-token Edge Function and cannot be forged without the JWT
secret.

## Read-Only Enforcement

The dashboard enforces read-only at multiple levels:

1. **UI level**: No mutation buttons or forms are rendered.
2. **Client level**: The Supabase client only calls `SELECT` queries
   and read-only RPC functions.
3. **RLS level**: If a mutation were somehow attempted, RLS policies
   for `authenticated` role only grant `SELECT`. `INSERT`/`UPDATE` on
   sensitive tables requires `service_role` (Edge Functions only).

## Performance Targets

| Metric | Target |
|--------|--------|
| First load (decisions list) | <3 seconds |
| Subsequent navigation | <1 second |
| Search results | <2 seconds |
| Dashboard stats | <3 seconds |
| Token refresh | <500ms (transparent) |

## Deployment

- **Platform**: Vercel (automatic from `packages/web` directory).
- **Environment variables**: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Domain**: `dashboard.teamind.dev` (or similar).
- **Build**: `next build` in `packages/web`.
- **Preview**: Vercel preview deployments per PR.

## Testing Strategy

- **Auth**: Unit tests for token exchange, refresh, expiry detection.
- **Components**: React Testing Library for decision card, search bar,
  status badge rendering.
- **Integration**: Mock Supabase client, verify correct queries for
  each page.
- **E2E**: Playwright test: enter API key -> see decisions -> search
  -> navigate to all pages.
- **Tenant isolation**: Test that queries include org_id filter (via
  mock inspection).
