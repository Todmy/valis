/**
 * T035: Root page — redirect to /dashboard when authenticated.
 * AuthGate handles the login form when not authenticated.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  // AuthGate shows login when no session; this is the post-login redirect
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-gray-400">Redirecting to dashboard...</p>
    </div>
  );
}
