/**
 * POST /api/auth-session — Exchange Supabase Auth session for Valis JWT.
 *
 * Called by dashboard after Supabase Auth magic link login.
 * Looks up member by email, returns Valis JWT + session info.
 * No API key needed — Supabase Auth token proves identity.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, unauthorized } from '@/lib/api-response';
import { SignJWT } from 'jose';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return unauthorized('Missing auth token');
    }
    const accessToken = authHeader.slice(7);

    const supabase = createServerClient();

    // Verify Supabase Auth token
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user?.email) {
      return unauthorized('Invalid or expired session');
    }

    // Find member by email
    const { data: member, error: memberErr } = await supabase
      .from('members')
      .select('id, author_name, org_id, role, api_key, auth_user_id')
      .eq('email', user.email)
      .is('revoked_at', null)
      .single();

    if (memberErr || !member) {
      return jsonResponse({
        error: 'no_member',
        message: `No Valis account linked to ${user.email}. Run \`valis init\` first.`,
      }, 404);
    }

    // Ensure auth_user_id is linked (auto-link on first login)
    if (!member.auth_user_id && user.id) {
      await supabase.from('members').update({ auth_user_id: user.id }).eq('id', member.id);
    }

    // Get org info
    const { data: org } = await supabase
      .from('orgs')
      .select('name')
      .eq('id', member.org_id)
      .single();

    // Mint Valis JWT (same as exchange-token)
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return jsonResponse({ error: 'server_config_error' }, 500);
    }

    const secret = new TextEncoder().encode(jwtSecret);
    const token = await new SignJWT({
      sub: member.id,
      role: 'authenticated',
      iss: 'valis',
      org_id: member.org_id,
      member_role: member.role,
      author_name: member.author_name,
      hosted: true,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(secret);

    return jsonResponse({
      token,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      member_id: member.id,
      org_id: member.org_id,
      org_name: org?.name ?? '',
      role: member.role,
      author_name: member.author_name,
      auth_mode: 'jwt',
      api_key: member.api_key,
    }, 200);
  } catch (err) {
    console.error('auth-session: error', (err as Error).message);
    return jsonResponse({ error: 'session_exchange_failed' }, 500);
  }
}
