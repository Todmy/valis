/**
 * T011: Join org via invite code.
 *
 * Public endpoint. Looks up org by invite_code, creates member with tmm_ key.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse } from '@/lib/api-response';
import { generateMemberKey } from '@/lib/api-keys';

const MEMBER_LIMITS: Record<string, number> = {
  free: 5,
  team: 25,
  business: 50,
  enterprise: 500,
};

export async function POST(request: NextRequest) {
  try {
    const { invite_code, author_name } = await request.json();

    if (!invite_code || typeof invite_code !== 'string') {
      return jsonResponse({ error: 'invite_code_required' }, 400);
    }
    if (!author_name || typeof author_name !== 'string' || author_name.trim().length === 0) {
      return jsonResponse({ error: 'author_name_required' }, 400);
    }

    const supabase = createServerClient();

    const { data: org, error: orgError } = await supabase
      .from('orgs')
      .select('id, name, plan, invite_code')
      .eq('invite_code', invite_code.trim().toUpperCase())
      .single();

    if (orgError || !org) {
      return jsonResponse({ error: 'invalid_invite_code' }, 404);
    }

    // Check member limit
    const { count: memberCount } = await supabase
      .from('members')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', org.id)
      .is('revoked_at', null);

    const limit = MEMBER_LIMITS[org.plan] || 5;
    if ((memberCount || 0) >= limit) {
      return jsonResponse({ error: 'member_limit_reached' }, 403);
    }

    // Check if already member
    const { data: existingMember } = await supabase
      .from('members')
      .select('id')
      .eq('org_id', org.id)
      .eq('author_name', author_name.trim())
      .is('revoked_at', null)
      .single();

    if (existingMember) {
      return jsonResponse({ error: 'already_member' }, 409);
    }

    // Insert member
    const memberKey = generateMemberKey();
    const { data: memberData, error: insertError } = await supabase
      .from('members')
      .insert({
        org_id: org.id,
        author_name: author_name.trim(),
        role: 'member',
        api_key: memberKey,
      })
      .select('id')
      .single();

    if (insertError || !memberData) {
      return jsonResponse({ error: 'join_failed' }, 500);
    }

    return jsonResponse(
      {
        org_id: org.id,
        org_name: org.name,
        invite_code: org.invite_code,
        member_id: memberData.id,
        member_api_key: memberKey,
        role: 'member',
      },
      200,
    );
  } catch (err) {
    console.error('join-org error:', (err as Error).message);
    return jsonResponse({ error: 'join_failed' }, 500);
  }
}
