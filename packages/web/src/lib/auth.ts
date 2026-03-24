/**
 * T032: Auth module — API key entry -> exchange-token -> JWT in sessionStorage.
 *
 * Security model:
 * - API key stored in sessionStorage (cleared on tab close).
 * - JWT held in memory only (never persisted to storage).
 * - All queries go through Supabase with JWT — RLS enforces tenant isolation.
 */

import type { AuthSession, ExchangeTokenResponse } from './types.js';

const API_KEY_STORAGE_KEY = 'teamind_api_key';

/** Minimum remaining lifetime before we trigger a token refresh. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Exchange a member API key (tmm_...) or org API key (tm_...) for a JWT session.
 */
export async function exchangeToken(apiKey: string): Promise<AuthSession> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new AuthError('NEXT_PUBLIC_SUPABASE_URL is not configured');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/exchange-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new AuthError(`Invalid API key: ${text}`);
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

/**
 * Refresh an expiring session by re-exchanging the stored API key.
 */
export async function refreshToken(): Promise<AuthSession> {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new AuthError('Session expired. Please re-enter your API key.');
  }
  return exchangeToken(apiKey);
}

/**
 * Check if a session is expiring soon (within REFRESH_BUFFER_MS).
 */
export function isExpiringSoon(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;
}

/**
 * Store the API key in sessionStorage.
 */
export function storeApiKey(apiKey: string): void {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  }
}

/**
 * Retrieve the stored API key from sessionStorage.
 */
export function getStoredApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(API_KEY_STORAGE_KEY);
}

/**
 * Clear stored credentials on logout.
 */
export function clearAuth(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(API_KEY_STORAGE_KEY);
  }
}
