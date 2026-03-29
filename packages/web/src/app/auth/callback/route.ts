import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirect = searchParams.get('redirect') || '/dashboard';

  if (code) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      await supabase.auth.exchangeCodeForSession(code);
    } catch (err) {
      console.error('auth callback: failed to exchange code', (err as Error).message);
    }
  }

  // Validate redirect is relative (prevent open redirect)
  const safeRedirect = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard';

  return NextResponse.redirect(`${origin}${safeRedirect}`);
}
