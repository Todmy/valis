'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase-browser';

export default function DeviceApprovalPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = searchParams.get('code') || '';

  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [action, setAction] = useState<'idle' | 'approving' | 'denying' | 'done'>('idle');
  const [result, setResult] = useState<{ status: string; org_name?: string; author_name?: string } | null>(null);
  const [error, setError] = useState('');

  const supabase = createBrowserClient();

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push(`/auth/login?redirect=${encodeURIComponent(`/auth/device?code=${code}`)}`);
        return;
      }
      setAuthenticated(true);
      setChecking(false);
    }
    checkAuth();
  }, [supabase, router, code]);

  async function handleAction(actionType: 'approve' | 'deny') {
    setAction(actionType === 'approve' ? 'approving' : 'denying');
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Session expired. Please log in again.');
        return;
      }

      const res = await fetch('/api/device-approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ user_code: code, action: actionType }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 410) {
          setError('This code has expired. Run `valis login` again in your terminal.');
        } else if (res.status === 404) {
          setError('Code not found. Check the code and try again.');
        } else {
          setError(data.message || data.error || 'Action failed');
        }
        setAction('idle');
        return;
      }

      setResult(data);
      setAction('done');
    } catch {
      setError('Network error. Please try again.');
      setAction('idle');
    }
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-gray-400">Checking authentication...</div>
      </div>
    );
  }

  if (!code) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="w-full max-w-md p-8 bg-gray-900 rounded-lg border border-gray-800 text-center">
          <h1 className="text-xl font-bold text-gray-100 mb-2">No Device Code</h1>
          <p className="text-gray-400 text-sm">
            Run <code className="text-brand-400 bg-gray-800 px-1 rounded">valis login</code> in your terminal to generate a code.
          </p>
        </div>
      </div>
    );
  }

  if (!authenticated) return null;

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950">
      <div className="w-full max-w-md p-8 bg-gray-900 rounded-lg border border-gray-800">
        {action === 'done' && result ? (
          <div className="text-center">
            <div className={`text-lg font-bold mb-2 ${result.status === 'approved' ? 'text-green-400' : 'text-red-400'}`}>
              {result.status === 'approved' ? 'Device Approved' : 'Login Denied'}
            </div>
            {result.status === 'approved' && (
              <p className="text-gray-400 text-sm">
                Logged in as <span className="text-gray-200">{result.author_name}</span> ({result.org_name}).
                You can close this tab.
              </p>
            )}
            {result.status === 'denied' && (
              <p className="text-gray-400 text-sm">The device login was denied. You can close this tab.</p>
            )}
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-100 mb-1">Approve Device Login</h1>
            <p className="text-gray-400 text-sm mb-6">
              A terminal is requesting access to your Valis account. Verify the code matches.
            </p>

            <div className="text-center mb-6">
              <div className="text-3xl font-mono font-bold text-brand-400 tracking-widest">
                {code}
              </div>
              <p className="text-gray-500 text-xs mt-1">Device code</p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded-md text-red-300 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => handleAction('approve')}
                disabled={action !== 'idle'}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {action === 'approving' ? 'Approving...' : 'Approve'}
              </button>
              <button
                onClick={() => handleAction('deny')}
                disabled={action !== 'idle'}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {action === 'denying' ? 'Denying...' : 'Deny'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
