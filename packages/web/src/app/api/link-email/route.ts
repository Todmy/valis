/**
 * POST /api/link-email — Link a Supabase Auth email to an existing member via API key.
 *
 * Used when a user logs in via magic link but their member record has no email.
 * They provide their tmm_ API key to prove ownership, and we update members.email.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, badRequest, unauthorized } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    // Get the Supabase Auth email from Authorization header
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const body = await request.json();
    const { api_key } = body as { api_key?: string };

    if (!api_key || !api_key.startsWith('tmm_')) {
      return badRequest('Valid member API key (tmm_...) required');
    }

    const supabase = createServerClient();

    // If we have an auth token, get the email from it
    let email: string | null = null;
    if (accessToken) {
      const { data: { user } } = await supabase.auth.getUser(accessToken);
      email = user?.email ?? null;
    }

    if (!email) {
      return unauthorized('Valid Supabase Auth session required');
    }

    // Find member by API key
    const { data: member, error: memberErr } = await supabase
      .from('members')
      .select('id, email, author_name')
      .eq('api_key', api_key)
      .is('revoked_at', null)
      .single();

    if (memberErr || !member) {
      return jsonResponse({ error: 'invalid_api_key', message: 'No active member found for this API key' }, 404);
    }

    if (member.email && member.email !== email) {
      return jsonResponse({ error: 'email_mismatch', message: 'This member is already linked to a different email' }, 409);
    }

    // Get auth user ID for RLS linking
    const { data: { user: authUser } } = await supabase.auth.getUser(accessToken);
    const authUserId = authUser?.id ?? null;

    // Update member with email + auth_user_id
    const updateData: Record<string, unknown> = { email };
    if (authUserId) updateData.auth_user_id = authUserId;

    const { error: updateErr } = await supabase
      .from('members')
      .update(updateData)
      .eq('id', member.id);

    if (updateErr) {
      console.error('link-email: update failed', updateErr.message);
      return jsonResponse({ error: 'update_failed' }, 500);
    }

    return jsonResponse({ status: 'linked', email, author_name: member.author_name }, 200);
  } catch (err) {
    console.error('link-email: error', (err as Error).message);
    return jsonResponse({ error: 'link_failed' }, 500);
  }
}
