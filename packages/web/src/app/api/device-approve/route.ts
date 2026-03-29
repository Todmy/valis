import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, badRequest, unauthorized } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    // Extract Supabase Auth token — accept both Bearer header and cookie
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!accessToken) {
      return unauthorized('Missing auth token. Log in at /auth/login first.');
    }

    const supabase = createServerClient();

    // Verify the Supabase Auth token server-side
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user?.email) {
      return unauthorized('Invalid or expired session. Log in again.');
    }

    const body = await request.json();
    const { user_code, action } = body as { user_code?: string; action?: string };

    if (!user_code || !action || !['approve', 'deny'].includes(action)) {
      return badRequest('user_code and action (approve/deny) required');
    }

    // Validate user_code format
    if (!/^[A-Z]{4}-\d{4}$/.test(user_code)) {
      return badRequest('invalid_code_format');
    }

    if (action === 'deny') {
      // Atomic deny: only if still pending
      const { data: denied } = await supabase
        .from('device_codes')
        .update({ status: 'denied' })
        .eq('user_code', user_code)
        .eq('status', 'pending')
        .select('id');

      if (!denied?.length) {
        return jsonResponse({ error: 'code_not_found_or_used' }, 409);
      }
      return jsonResponse({ status: 'denied' }, 200);
    }

    // Approve: find member by email
    const { data: member, error: memberErr } = await supabase
      .from('members')
      .select('id, api_key, author_name, org_id')
      .eq('email', user.email)
      .is('revoked_at', null)
      .single();

    if (memberErr || !member) {
      return jsonResponse({
        error: 'no_member_found',
        message: `No Valis member found for ${user.email}. Register first with valis init.`,
      }, 404);
    }

    const { data: org } = await supabase
      .from('orgs')
      .select('name')
      .eq('id', member.org_id)
      .single();

    // Atomic approve: only if still pending and not expired
    const { data: approved } = await supabase
      .from('device_codes')
      .update({
        status: 'approved',
        member_id: member.id,
        member_api_key: member.api_key,
      })
      .eq('user_code', user_code)
      .eq('status', 'pending')
      .gte('expires_at', new Date().toISOString())
      .select('id');

    if (!approved?.length) {
      // Check if expired or already used
      const { data: existing } = await supabase
        .from('device_codes')
        .select('status, expires_at')
        .eq('user_code', user_code)
        .single();

      if (!existing) {
        return jsonResponse({ error: 'code_not_found' }, 404);
      }
      if (new Date(existing.expires_at) < new Date()) {
        return jsonResponse({ error: 'expired' }, 410);
      }
      return jsonResponse({ error: 'code_already_used', status: existing.status }, 409);
    }

    return jsonResponse({
      status: 'approved',
      org_name: org?.name ?? '',
      author_name: member.author_name,
    }, 200);
  } catch (err) {
    console.error('device-approve: error', (err as Error).message);
    return jsonResponse({ error: 'approve_failed' }, 500);
  }
}
