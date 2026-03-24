/**
 * T032: AuthGate component — login form (API key entry) + protected route wrapper.
 *
 * When unauthenticated, shows the API key entry form.
 * When authenticated, renders children.
 */

'use client';

import { useState, type ReactNode, type FormEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const { session, loading, login } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-500 text-lg">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return <LoginForm onLogin={login} />;
  }

  return <>{children}</>;
}

function LoginForm({ onLogin }: { onLogin: (apiKey: string) => Promise<void> }) {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await onLogin(apiKey.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Teamind Dashboard</h1>
        <p className="text-gray-600 mb-6">
          Enter your member API key to access your team&apos;s decision brain.
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 mb-1">
            API Key
          </label>
          <input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="tmm_... or tm_..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 mb-4"
            autoFocus
            disabled={submitting}
          />

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !apiKey.trim()}
            className="w-full py-2 px-4 bg-brand-600 text-white rounded-md font-medium hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-500 text-center">
          Read-only dashboard. All mutations happen through the CLI.
        </p>
      </div>
    </div>
  );
}
