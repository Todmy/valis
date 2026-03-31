/**
 * Client-side app shell.
 *
 * Auth flow:
 * - /auth/* pages: bare render (Supabase Auth magic link)
 * - All other pages: check Supabase Auth session → redirect to /auth/login if not
 *   → use Supabase Auth session directly for data fetching (RLS via auth.uid())
 */

'use client';

import { type ReactNode, useEffect, useState, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase-browser';
import type { SupabaseClient } from '@supabase/supabase-js';

// Simple context for Supabase client + user info
import { createContext, useContext } from 'react';

interface DashboardAuth {
  supabase: SupabaseClient;
  userEmail: string;
  userId: string;
}

const DashboardAuthContext = createContext<DashboardAuth | null>(null);

export function useDashboardAuth() {
  const ctx = useContext(DashboardAuthContext);
  if (!ctx) throw new Error('useDashboardAuth must be used within AppShell');
  return ctx;
}

// Nav component (simplified — uses DashboardAuth instead of useAuth)
function DashboardNav({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const pathname = usePathname();

  const links = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/decisions', label: 'Decisions' },
    { href: '/search', label: 'Search' },
    { href: '/proposed', label: 'Proposed' },
    { href: '/contradictions', label: 'Contradictions' },
  ];

  return (
    <nav className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col p-4 gap-1">
      <div className="text-brand-400 font-bold text-lg mb-4">Valis</div>
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className={`px-3 py-2 rounded-md text-sm transition-colors ${
            pathname === link.href
              ? 'bg-gray-800 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          {link.label}
        </a>
      ))}
      <a
        href="/dashboard#projects"
        className={`px-3 py-2 rounded-md text-sm transition-colors ${
          pathname?.startsWith('/projects/')
            ? 'bg-gray-800 text-white'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'
        }`}
      >
        Projects
      </a>

      <div className="mt-auto border-t border-gray-800 pt-3">
        <div className="text-xs text-gray-400 mb-2 truncate">{email}</div>
        <button
          onClick={onSignOut}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const [checking, setChecking] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [userId, setUserId] = useState('');

  const isAuthPage = pathname?.startsWith('/auth/');

  useEffect(() => {
    if (isAuthPage) {
      setChecking(false);
      return;
    }

    async function checkSession() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserEmail(session.user.email ?? '');
        setUserId(session.user.id);
        setChecking(false);
      } else {
        router.push(`/auth/login?redirect=${encodeURIComponent(pathname || '/')}`);
      }
    }
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user?: { email?: string; id: string } } | null) => {
        if (session?.user) {
          setUserEmail(session.user.email ?? '');
          setUserId(session.user.id);
          setChecking(false);
        } else if (!isAuthPage) {
          router.push('/auth/login');
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [supabase, isAuthPage, pathname, router]);

  // Auth pages: bare render
  if (isAuthPage) {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!userId) return null;

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  return (
    <DashboardAuthContext value={{ supabase, userEmail, userId }}>
      <div className="flex min-h-screen">
        <DashboardNav email={userEmail} onSignOut={handleSignOut} />
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </DashboardAuthContext>
  );
}
