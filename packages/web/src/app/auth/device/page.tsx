'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase-browser';

export default function DeviceApprovalPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-gray-950"><div className="text-gray-400">Loading...</div></div>}>
      <DeviceApprovalContent />
    </Suspense>
  );
}

function DeviceApprovalContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = searchParams.get('code') || '';

  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [action, setAction] = useState<'idle' | 'approving' | 'denying' | 'done'>('idle');
  const [result, setResult] = useState<{ status: string; org_name?: string; author_name?: string } | null>(null);
  const [error, setError] = useState('');
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [linking, setLinking] = useState(false);

  const supabase = useMemo(() => createBrowserClient(), []);

  // Auth check + listen for auth state changes (magic link return)
  useEffect(() => {
    if (!code) {
      setChecking(false);
      return;
    }

    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setAuthenticated(true);
        setChecking(false);
        return;
      }
      // Not authenticated — redirect to login
      router.push(`/auth/login?redirect=${encodeURIComponent(`/auth/device?code=${code}`)}`);
    }
    checkAuth();

    // Listen for auth state change (user returns from magic link)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setAuthenticated(true);
        setChecking(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, router, code]);

  async function handleAction(actionType: 'approve' | 'deny') {
    setAction(actionType === 'approve' ? 'approving' : 'denying');
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Session expired. Please log in again.');
        setAction('idle');
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
          if (data.error === 'no_member_found') {
            setError('Your email is not linked to a Valis account. Run `valis init` with your email, or ask your team admin to add your email to your member record.');
            setShowLinkForm(true);
          } else {
            setError('Code not found. Check the code and try again.');
          }
        } else if (res.status === 409) {
          setError(
            data.status === 'approved'
              ? 'This device was already approved. You can close this tab.'
              : 'This code was already used. Run `valis login` again.'
          );
        } else {
          setError(data.message || data.error || 'Action failed. Try again.');
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

  // No device code provided
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

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-gray-400">Checking authentication...</div>
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

            {showLinkForm && (
              <div className="mb-4 p-4 bg-gray-800 border border-gray-700 rounded-md">
                <p className="text-gray-300 text-sm mb-3">Link your API key to this email to continue:</p>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="tmm_..."
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-md text-gray-100 placeholder-gray-500 text-sm mb-2"
                />
                <button
                  onClick={async () => {
                    if (!apiKey.startsWith('tmm_')) {
                      setError('API key must start with tmm_');
                      return;
                    }
                    setLinking(true);
                    try {
                      const { data: { session: linkSession } } = await supabase.auth.getSession();
                      const res = await fetch('/api/link-email', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${linkSession?.access_token}`,
                        },
                        body: JSON.stringify({ api_key: apiKey }),
                      });
                      if (res.ok) {
                        setShowLinkForm(false);
                        setError('');
                        // Retry approve
                        handleAction('approve');
                      } else {
                        const data = await res.json();
                        setError(data.message || 'Failed to link email');
                      }
                    } catch {
                      setError('Network error');
                    } finally {
                      setLinking(false);
                    }
                  }}
                  disabled={linking || !apiKey}
                  className="w-full px-3 py-2 bg-brand-600 text-white rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {linking ? 'Linking...' : 'Link & Approve'}
                </button>
              </div>
            )}

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
