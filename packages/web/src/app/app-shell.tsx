/**
 * Client-side app shell.
 *
 * Auth flow:
 * 1. /auth/* pages → bare render (Supabase Auth magic link)
 * 2. All other pages → check Supabase Auth session
 *    → if no session → redirect to /auth/login
 *    → if session → exchange for Valis JWT via /api/auth-session
 *    → provide API key to AuthProvider for dashboard data fetching
 */

'use client';

import { type ReactNode, useEffect, useState, useMemo, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase-browser';
import { AuthProvider } from '@/hooks/use-auth';
import { Nav } from '@/components/nav';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const [checking, setChecking] = useState(true);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAuthPage = pathname?.startsWith('/auth/');

  const exchangeSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push(`/auth/login?redirect=${encodeURIComponent(pathname || '/')}`);
      return;
    }

    // Exchange Supabase Auth token for Valis session
    try {
      const res = await fetch('/api/auth-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setApiKey(data.api_key);
        setChecking(false);
      } else if (res.status === 404) {
        // No member linked to this email
        setError('No Valis account linked to your email. Run `valis init` with your email first.');
        setChecking(false);
      } else {
        setError('Failed to load session. Try refreshing.');
        setChecking(false);
      }
    } catch {
      setError('Cannot reach server. Check your connection.');
      setChecking(false);
    }
  }, [supabase, pathname, router]);

  useEffect(() => {
    if (isAuthPage) {
      setChecking(false);
      return;
    }

    exchangeSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setApiKey(null);
        router.push('/auth/login');
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, isAuthPage, exchangeSession, router]);

  // Auth pages: bare render
  if (isAuthPage) {
    return <>{children}</>;
  }

  // Loading
  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  // Error (no member linked)
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="w-full max-w-md p-8 bg-gray-900 rounded-lg border border-gray-800 text-center">
          <h1 className="text-xl font-bold text-gray-100 mb-3">Account Not Found</h1>
          <p className="text-gray-400 text-sm mb-4">
            No Valis account is linked to your email yet.
          </p>
          <p className="text-gray-500 text-xs mb-6">
            To get started, install the CLI and create your account:
          </p>
          <div className="bg-gray-800 rounded-md p-3 mb-6 text-left">
            <code className="text-brand-400 text-sm">
              npm install -g valis<br />
              valis init
            </code>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                router.push('/auth/login');
              }}
              className="px-4 py-2 bg-gray-700 text-gray-200 rounded-md text-sm hover:bg-gray-600 transition-colors"
            >
              Try different email
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Not ready
  if (!apiKey) {
    return null;
  }

  // Authenticated — auto-login AuthProvider with the API key
  return (
    <AuthProvider autoLoginKey={apiKey}>
      <div className="flex min-h-screen">
        <Nav />
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </AuthProvider>
  );
}
