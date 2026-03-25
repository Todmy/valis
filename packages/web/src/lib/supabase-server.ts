/**
 * T003: Shared Supabase server client utility.
 *
 * Creates a service-role Supabase client for use in API routes.
 * This bypasses RLS — only use in trusted server-side code.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createServerClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
