# Quickstart: Remote MCP Server

## For Users

### Connect from claude.ai

1. Open claude.ai → Settings → MCP Servers
2. Add new server:
   - **URL**: `https://valis.krukit.co/api/mcp`
   - **Auth type**: Bearer token
   - **Token**: Your Valis API key (starts with `tmm_`)
3. Save — 4 tools should appear: valis_store, valis_search, valis_context, valis_lifecycle

### Connect from any MCP client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'my-app', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(
  new URL('https://valis.krukit.co/api/mcp'),
  {
    requestInit: {
      headers: {
        Authorization: 'Bearer tmm_your_api_key_here',
      },
    },
  },
);
await client.connect(transport);

// List tools
const tools = await client.listTools();

// Search decisions
const result = await client.callTool('valis_search', {
  query: 'authentication',
  limit: 5,
});
```

## For Developers

### Local development

```bash
# From repo root
cd packages/web
pnpm dev

# Test endpoint locally
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer tmm_your_key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

### Required environment variables

These are already set on Vercel for existing API routes:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `QDRANT_URL`
- `QDRANT_API_KEY`

### Run tests

```bash
cd packages/web
pnpm test
```
