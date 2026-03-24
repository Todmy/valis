/**
 * T034: Root layout with nav sidebar, AuthGate wrapper.
 */

import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from './app-shell';

export const metadata: Metadata = {
  title: 'Teamind Dashboard',
  description: 'Read-only web dashboard for your team decision brain',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
