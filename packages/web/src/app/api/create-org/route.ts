/**
 * T012: Create org route.
 *
 * Public endpoint. Creates org + admin member with generated keys.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse } from '@/lib/api-response';
import {
  generateOrgApiKey,
  generateMemberKey,
  generateInviteCode,
} from '@/lib/api-keys';

export async function POST(request: NextRequest) {
  try {
    const { name, author_name } = await request.json();

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return jsonResponse({ error: 'name_required' }, 400);
    }
    if (!author_name || typeof author_name !== 'string' || author_name.trim().length === 0) {
      return jsonResponse({ error: 'author_name_required' }, 400);
    }

    const supabase = createServerClient();

    const orgId = crypto.randomUUID();
    const apiKey = generateOrgApiKey();
    const inviteCode = generateInviteCode();

    const { error: orgError } = await supabase.from('orgs').insert({
      id: orgId,
      name: name.trim(),
      api_key: apiKey,
      invite_code: inviteCode,
    });

    if (orgError) {
      return jsonResponse({ error: 'creation_failed', message: orgError.message }, 500);
    }

    const memberKey = generateMemberKey();
    const { data: memberData, error: memberError } = await supabase
      .from('members')
      .insert({
        org_id: orgId,
        author_name: author_name.trim(),
        role: 'admin',
        api_key: memberKey,
      })
      .select('id')
      .single();

    if (memberError || !memberData) {
      await supabase.from('orgs').delete().eq('id', orgId);
      return jsonResponse(
        { error: 'creation_failed', message: memberError?.message ?? 'member insert failed' },
        500,
      );
    }

    return jsonResponse(
      {
        org_id: orgId,
        api_key: apiKey,
        invite_code: inviteCode,
        author_name: author_name.trim(),
        role: 'admin',
        member_id: memberData.id,
        member_api_key: memberKey,
      },
      200,
    );
  } catch (err) {
    console.error('create-org error:', (err as Error).message);
    return jsonResponse({ error: 'creation_failed', message: (err as Error).message }, 500);
  }
}
