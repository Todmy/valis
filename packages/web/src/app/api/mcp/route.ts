import { type NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from 'valis/dist/src/mcp/server.js';
import { extractBearerToken, authenticateApiKey } from '@/lib/api-auth';
import { buildServerConfig } from '@/lib/mcp-config';
import { createServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
};

function jsonRpcError(code: number, message: string, httpStatus: number): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }),
    { status: httpStatus, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  // 1. Auth
  const token = extractBearerToken(request);
  if (!token) {
    return jsonRpcError(-32000, 'Unauthorized', 401);
  }

  const supabase = createServerClient();
  const auth = await authenticateApiKey(supabase, token);
  if (!auth) {
    return jsonRpcError(-32000, 'Unauthorized', 401);
  }

  // 2. Build server config from auth + env
  let config;
  try {
    config = buildServerConfig(auth, token);
  } catch (err) {
    return jsonRpcError(-32603, (err as Error).message, 500);
  }

  // 3. Create MCP server with injected config
  const mcpServer = createMcpServer(config);

  // 4. Create stateless transport
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // 5. Connect and handle
  await mcpServer.connect(transport);
  const response = await transport.handleRequest(request);

  // 6. Merge CORS headers into transport's response
  const mergedHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    mergedHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: mergedHeaders,
  });
}
