/**
 * Client-side app shell.
 *
 * - /auth/* pages: bare render (Supabase Auth magic link flow)
 * - Everything else: AuthProvider + AuthGate (API key auth for data fetching)
 *
 * Dashboard pages still use API key auth for data fetching.
 * Full migration to Supabase Auth is a separate task.
 */

'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AuthProvider } from '@/hooks/use-auth';
import { AuthGate } from '@/components/auth-gate';
import { Nav } from '@/components/nav';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // /auth/* pages have their own Supabase Auth flow
  if (pathname?.startsWith('/auth/')) {
    return <>{children}</>;
  }

  // All other pages: API key auth for dashboard data fetching
  return (
    <AuthProvider>
      <AuthGate>
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 p-6 overflow-auto">{children}</main>
        </div>
      </AuthGate>
    </AuthProvider>
  );
}
