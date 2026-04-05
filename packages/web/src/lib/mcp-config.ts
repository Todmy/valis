import type { AuthResult } from './api-auth';
import type { ServerConfig } from 'valis/dist/src/types.js';

/**
 * Build a ServerConfig from an authenticated API key result + env vars.
 * Used by the remote MCP endpoint to provide config that tool handlers
 * normally read from the filesystem via loadConfig().
 */
export function buildServerConfig(
  auth: AuthResult,
  bearerToken: string,
): ServerConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey || !qdrantUrl || !qdrantApiKey) {
    const missing = [
      !supabaseUrl && 'SUPABASE_URL',
      !supabaseServiceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
      !qdrantUrl && 'QDRANT_URL',
      !qdrantApiKey && 'QDRANT_API_KEY',
    ].filter(Boolean);
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  return {
    org_id: auth.orgId,
    member_id: auth.memberId,
    author_name: auth.authorName,
    role: auth.role,
    auth_mode: 'jwt',
    supabase_url: supabaseUrl,
    supabase_service_role_key: supabaseServiceRoleKey,
    qdrant_url: qdrantUrl,
    qdrant_api_key: qdrantApiKey,
    api_key: bearerToken,
    member_api_key: bearerToken,
  };
}
