# Quickstart: Valis MVP (Developer Setup)

## Prerequisites

- Node.js 20+
- pnpm 9+
- Supabase account (pro plan) with project created
- Qdrant Cloud account with cluster provisioned

## 1. Clone and install

```bash
git clone git@github.com:Todmy/valis.git
cd valis
pnpm install
```

## 2. Configure Supabase

```bash
# Link to your Supabase project
npx supabase link --project-ref <your-project-ref>

# Run migrations (creates orgs, members, decisions, rate_limits tables)
npx supabase db push

# Deploy Edge Functions
npx supabase functions deploy create-org
npx supabase functions deploy join-org
npx supabase functions deploy rotate-key
```

## 3. Set environment variables

Create `packages/cli/.env` (gitignored):

```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # for Edge Functions only
QDRANT_URL=https://<your-cluster>.qdrant.io
QDRANT_API_KEY=<your-qdrant-api-key>
```

## 4. Build and link CLI

```bash
cd packages/cli
pnpm build
pnpm link --global   # makes `valis` available globally
```

## 5. Test the flow

```bash
# Create an org
valis init
# → Creates org, configures IDEs, seeds decisions

# Check status
valis status
# → Shows cloud connectivity, org info, decision count

# Start MCP server (normally done by IDE, but useful for testing)
valis serve
# → Blocks on stdio — use MCP Inspector to test tools

# Search
valis search "authentication"

# Dashboard
valis dashboard

## 6. Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector valis serve
```

This opens a browser UI to test `valis_store`, `valis_search`,
and `valis_context` interactively.

## 7. Run tests

```bash
cd packages/cli
pnpm test           # all tests
pnpm test:watch     # watch mode
```

## Development workflow

- Edit source in `packages/cli/src/`
- `pnpm build` to compile
- Test CLI: `valis <command>`
- Test MCP: use MCP Inspector
- Test Edge Functions: `npx supabase functions serve`
