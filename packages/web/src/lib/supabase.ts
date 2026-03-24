/**
 * T031: Supabase client factory with JWT accessToken callback.
 *
 * Creates a browser Supabase client that provides the JWT via the
 * accessToken callback. Auto-refreshes before 1h expiry.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthSession } from './types.js';
import { isExpiringSoon, refreshToken } from './auth.js';

/**
 * Create a Supabase client authenticated with the given session.
 *
 * The accessToken callback is called on every request, allowing
 * transparent token refresh before expiry.
 */
export function createAuthenticatedClient(
  sessionRef: { current: AuthSession },
): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(supabaseUrl, supabaseAnonKey, {
    accessToken: async () => {
      // Refresh if within 5 minutes of expiry
      if (isExpiringSoon(sessionRef.current.expiresAt)) {
        try {
          sessionRef.current = await refreshToken();
        } catch {
          // If refresh fails, return current token — will get 401 on next request
        }
      }
      return sessionRef.current.jwt;
    },
  });
}
