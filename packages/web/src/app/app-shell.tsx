/**
 * Client-side app shell — wraps AuthProvider, AuthGate, and Nav sidebar.
 * Separated from layout.tsx because layout is a Server Component.
 */

'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AuthProvider } from '@/hooks/use-auth';
import { AuthGate } from '@/components/auth-gate';
import { Nav } from '@/components/nav';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // /auth/* pages have their own auth flow (Supabase Auth magic link).
  // No AuthGate, no Nav sidebar, no AuthProvider needed.
  if (pathname?.startsWith('/auth/')) {
    return <>{children}</>;
  }

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
