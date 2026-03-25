/**
 * T005: Shared API auth helpers.
 *
 * Extracts and validates Bearer tokens, resolves API keys to members/orgs,
 * decodes JWT payloads, and provides timing-safe string comparison.
 */

import { type NextRequest } from 'next/server';
import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthResult {
  memberId: string;
  orgId: string;
  role: string;
  authorName: string;
}

/**
 * Extract Bearer token from Authorization header.
 * Returns null if missing or malformed.
 */
export function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token || token.length < 4) {
    return null;
  }
  return token;
}

/**
 * Resolve a tmm_ or tm_ API key to a member/org.
 * Returns AuthResult or null if the key is invalid.
 */
export async function authenticateApiKey(
  supabase: SupabaseClient,
  apiKey: string,
): Promise<AuthResult | null> {
  const isPerMemberKey = apiKey.startsWith('tmm_');
  const isOrgKey = apiKey.startsWith('tm_') && !isPerMemberKey;

  if (!isPerMemberKey && !isOrgKey) {
    return null;
  }

  if (isPerMemberKey) {
    const { data: member, error: memberError } = await supabase
      .from('members')
      .select('id, org_id, author_name, role, api_key, revoked_at')
      .eq('api_key', apiKey)
      .is('revoked_at', null)
      .single();

    if (memberError || !member) {
      return null;
    }

    if (!timingSafeEqual(member.api_key, apiKey)) {
      return null;
    }

    return {
      memberId: member.id,
      orgId: member.org_id,
      role: member.role,
      authorName: member.author_name,
    };
  }

  // Org-level key
  const { data: org, error: orgError } = await supabase
    .from('orgs')
    .select('id, name, api_key')
    .eq('api_key', apiKey)
    .single();

  if (orgError || !org) {
    return null;
  }

  if (!timingSafeEqual(org.api_key, apiKey)) {
    return null;
  }

  // Resolve to first admin member
  const { data: admin, error: adminError } = await supabase
    .from('members')
    .select('id, author_name, role')
    .eq('org_id', org.id)
    .eq('role', 'admin')
    .is('revoked_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (adminError || !admin) {
    return null;
  }

  return {
    memberId: admin.id,
    orgId: org.id,
    role: admin.role,
    authorName: admin.author_name,
  };
}

/**
 * Decode JWT payload without verification (base64-decode only).
 * Used when the JWT was already verified by the gateway or when
 * we just need to read claims from a trusted source.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1];
  const decoded = Buffer.from(
    payload.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf-8');
  return JSON.parse(decoded);
}

/**
 * Constant-time string comparison using Node.js crypto.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');

  if (aBuf.byteLength !== bBuf.byteLength) {
    // Compare against self to maintain constant time, then return false
    nodeTimingSafeEqual(aBuf, aBuf);
    return false;
  }

  return nodeTimingSafeEqual(aBuf, bBuf);
}
