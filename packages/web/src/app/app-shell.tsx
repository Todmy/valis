/**
 * Client-side app shell.
 *
 * All pages use Supabase Auth (email magic link).
 * - /auth/* pages: bare render (login, callback, device approval)
 * - Everything else: check Supabase Auth session → redirect to /auth/login if not authenticated
 */

'use client';

import { type ReactNode, useEffect, useState, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase-browser';
import { Nav } from '@/components/nav';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  // /auth/* pages handle their own auth
  const isAuthPage = pathname?.startsWith('/auth/');

  useEffect(() => {
    if (isAuthPage) {
      setChecking(false);
      return;
    }

    async function checkSession() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setAuthenticated(true);
        setChecking(false);
      } else {
        router.push(`/auth/login?redirect=${encodeURIComponent(pathname || '/')}`);
      }
    }
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setAuthenticated(true);
        setChecking(false);
      } else {
        setAuthenticated(false);
        router.push('/auth/login');
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, isAuthPage, pathname, router]);

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

  // Not authenticated — redirect in progress
  if (!authenticated) {
    return null;
  }

  // Authenticated — show dashboard with nav
  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}
