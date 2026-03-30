'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase-browser';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-gray-950"><div className="text-gray-400">Loading...</div></div>}>
      <AuthContent />
    </Suspense>
  );
}

function AuthContent() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/dashboard';
  const [mode, setMode] = useState<'login' | 'register'>('login');

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950">
      <div className="w-full max-w-md">
        {/* Tabs */}
        <div className="flex mb-0 border-b border-gray-800">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${
              mode === 'login'
                ? 'text-gray-100 border-b-2 border-brand-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Sign in
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${
              mode === 'register'
                ? 'text-gray-100 border-b-2 border-brand-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Create account
          </button>
        </div>

        <div className="p-8 bg-gray-900 rounded-b-lg border border-t-0 border-gray-800">
          {mode === 'login' ? (
            <LoginForm redirect={redirect} />
          ) : (
            <RegisterForm redirect={redirect} />
          )}
        </div>
      </div>
    </div>
  );
}

function LoginForm({ redirect }: { redirect: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createBrowserClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
        },
      });

      if (authError) {
        setError(authError.message);
      } else {
        setSent(true);
      }
    } catch {
      setError('Failed to send magic link. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="text-green-400 text-lg font-medium mb-2">Check your email</div>
        <p className="text-gray-400 text-sm">
          We sent a magic link to <span className="text-gray-200">{email}</span>.
          Click the link to sign in.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="text-gray-400 mb-6 text-sm">Sign in with your email via magic link.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="login-email" className="block text-sm font-medium text-gray-300 mb-1">Email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          autoComplete="email"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading || !email}
          className="mt-4 w-full px-4 py-2 bg-brand-600 text-white rounded-md font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Sending...' : 'Send magic link'}
        </button>
      </form>
    </>
  );
}

function RegisterForm({ redirect }: { redirect: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Register via Valis API
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_name: name,
          project_name: projectName || 'default',
          author_name: name,
          email,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'org_name_taken') {
          setError('An account with this name already exists. Try signing in instead.');
        } else {
          setError(data.message || data.error || 'Registration failed');
        }
        setLoading(false);
        return;
      }

      // Account created — now send magic link to log in
      const supabase = createBrowserClient();
      await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
        },
      });

      setSuccess(true);
    } catch {
      setError('Registration failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="text-center">
        <div className="text-green-400 text-lg font-medium mb-2">Account created!</div>
        <p className="text-gray-400 text-sm">
          Check your email at <span className="text-gray-200">{email}</span> for a magic link to sign in.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="text-gray-400 mb-6 text-sm">Create your Valis account. Free tier included.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="reg-name" className="block text-sm font-medium text-gray-300 mb-1">Your name</label>
        <input
          id="reg-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Dmytro"
          required
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent mb-3"
        />

        <label htmlFor="reg-email" className="block text-sm font-medium text-gray-300 mb-1">Email</label>
        <input
          id="reg-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          autoComplete="email"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent mb-3"
        />

        <label htmlFor="reg-project" className="block text-sm font-medium text-gray-300 mb-1">Project name <span className="text-gray-500">(optional)</span></label>
        <input
          id="reg-project"
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="my-project"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        />

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading || !name || !email}
          className="mt-4 w-full px-4 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Creating...' : 'Create account'}
        </button>
      </form>
    </>
  );
}
