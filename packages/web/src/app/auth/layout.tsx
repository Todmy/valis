/**
 * Auth layout — bypasses AppShell (no AuthGate, no Nav sidebar).
 * Auth pages handle their own Supabase Auth flow.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
