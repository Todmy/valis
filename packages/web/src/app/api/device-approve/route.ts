import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, badRequest, unauthorized } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    // Extract Supabase Auth token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return unauthorized('Missing auth token');
    }
    const accessToken = authHeader.slice(7);

    const supabase = createServerClient();

    // Verify the Supabase Auth token and get user email
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user?.email) {
      return unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const { user_code, action } = body as { user_code?: string; action?: string };

    if (!user_code || !action || !['approve', 'deny'].includes(action)) {
      return badRequest('user_code and action (approve/deny) required');
    }

    // Validate user_code format (alphanumeric + dash only)
    if (!/^[A-Z]{4}-\d{4}$/.test(user_code)) {
      return badRequest('invalid_code_format');
    }

    // Find the device code
    const { data: code, error: codeErr } = await supabase
      .from('device_codes')
      .select('id, status, expires_at')
      .eq('user_code', user_code)
      .single();

    if (codeErr || !code) {
      return jsonResponse({ error: 'code_not_found' }, 404);
    }

    if (code.status !== 'pending') {
      return jsonResponse({ error: 'code_already_used', status: code.status }, 409);
    }

    if (new Date(code.expires_at) < new Date()) {
      await supabase.from('device_codes').update({ status: 'expired' }).eq('id', code.id);
      return jsonResponse({ error: 'expired' }, 410);
    }

    if (action === 'deny') {
      await supabase.from('device_codes').update({ status: 'denied' }).eq('id', code.id);
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
        message: `No Valis member found for email ${user.email}. Register first with valis init.`,
      }, 404);
    }

    const { data: org } = await supabase
      .from('orgs')
      .select('name')
      .eq('id', member.org_id)
      .single();

    // Update device code with member info
    await supabase.from('device_codes').update({
      status: 'approved',
      member_id: member.id,
      member_api_key: member.api_key,
    }).eq('id', code.id);

    return jsonResponse({
      status: 'approved',
      org_name: org?.name ?? '',
      author_name: member.author_name,
    }, 200);
  } catch (err) {
    return jsonResponse({ error: 'approve_failed', message: (err as Error).message }, 500);
  }
}
