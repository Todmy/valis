/**
 * T034: Auth context hook — session management, protected routes.
 *
 * Provides authentication state to the entire app via React context.
 * All routes behind AuthGate are protected.
 */

'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthSession } from '@/lib/types';
import { exchangeToken, storeApiKey, clearAuth, getStoredApiKey } from '@/lib/auth';
import { createAuthenticatedClient } from '@/lib/supabase';

interface AuthContextValue {
  /** Current session, null when not authenticated. */
  session: AuthSession | null;
  /** Authenticated Supabase client, null when not authenticated. */
  supabase: SupabaseClient | null;
  /** Whether authentication is in progress. */
  loading: boolean;
  /** Last authentication error. */
  error: string | null;
  /** Log in with an API key. */
  login: (apiKey: string) => Promise<void>;
  /** Log out and clear credentials. */
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, autoLoginKey }: { children: ReactNode; autoLoginKey?: string }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);

  const initClient = useCallback((newSession: AuthSession) => {
    sessionRef.current = newSession;
    const ref = { get current() { return sessionRef.current!; }, set current(s: AuthSession) { sessionRef.current = s; setSession(s); } };
    const client = createAuthenticatedClient(ref);
    setSupabase(client);
    setSession(newSession);
  }, []);

  const login = useCallback(async (apiKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const newSession = await exchangeToken(apiKey);
      storeApiKey(apiKey);
      initClient(newSession);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [initClient]);

  const logout = useCallback(() => {
    clearAuth();
    setSession(null);
    setSupabase(null);
    sessionRef.current = null;
  }, []);

  // On mount, auto-login with provided key or restore from storage
  useEffect(() => {
    const key = autoLoginKey || getStoredApiKey();
    if (key) {
      login(key).catch(() => {
        clearAuth();
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoginKey]);

  return (
    <AuthContext value={{ session, supabase, loading, error, login, logout }}>
      {children}
    </AuthContext>
  );
}

/**
 * Hook to access the auth context. Must be used within AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
