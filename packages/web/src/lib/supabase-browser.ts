import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr';

let browserClient: ReturnType<typeof createSSRBrowserClient> | null = null;

export function createBrowserClient() {
  if (browserClient) return browserClient;

  browserClient = createSSRBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  return browserClient;
}
