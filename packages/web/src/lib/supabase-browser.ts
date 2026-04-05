import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr';

let browserClient: ReturnType<typeof createSSRBrowserClient> | null = null;

export function createBrowserClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!url || !key) {
    // During static generation env vars may not exist — return a stub
    // that won't crash the build. Real client is created in the browser.
    return null as unknown as ReturnType<typeof createSSRBrowserClient>;
  }

  browserClient = createSSRBrowserClient(url, key);

  return browserClient;
}
