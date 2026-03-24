/**
 * T033: Navigation sidebar with Proposed (N) count badge.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useEffect, useState } from 'react';

interface NavItem {
  label: string;
  href: string;
  /** Whether to show a count badge next to the label. */
  badge?: number | null;
}

export function Nav() {
  const pathname = usePathname();
  const { supabase, session, logout } = useAuth();
  const [proposedCount, setProposedCount] = useState<number>(0);
  const [contradictionCount, setContradictionCount] = useState<number>(0);

  useEffect(() => {
    if (!supabase) return;

    async function fetchCounts() {
      const [proposedRes, contradictionRes] = await Promise.all([
        supabase!.from('decisions').select('id', { count: 'exact', head: true }).eq('status', 'proposed'),
        supabase!.from('contradictions').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      ]);
      setProposedCount(proposedRes.count ?? 0);
      setContradictionCount(contradictionRes.count ?? 0);
    }

    fetchCounts();
  }, [supabase]);

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Decisions', href: '/decisions' },
    { label: 'Search', href: '/search' },
    { label: 'Proposed', href: '/proposed', badge: proposedCount || null },
    { label: 'Contradictions', href: '/contradictions', badge: contradictionCount || null },
  ];

  return (
    <nav className="w-56 bg-gray-900 text-white flex flex-col min-h-screen">
      {/* Branding */}
      <div className="px-4 py-5 border-b border-gray-800">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          Teamind
        </Link>
        {session && (
          <div className="mt-1 text-xs text-gray-400 truncate" title={session.orgName}>
            {session.orgName}
          </div>
        )}
      </div>

      {/* Nav links */}
      <div className="flex-1 py-4">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-4 py-2 text-sm transition-colors ${
                active
                  ? 'bg-gray-800 text-white font-medium'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span>{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span className="ml-2 bg-yellow-500 text-gray-900 text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Footer */}
      {session && (
        <div className="border-t border-gray-800 px-4 py-3">
          <div className="text-xs text-gray-400 mb-1 truncate">{session.authorName}</div>
          <div className="text-xs text-gray-500 mb-2">{session.role}</div>
          <button
            onClick={logout}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
