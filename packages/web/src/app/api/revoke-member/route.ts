/**
 * T019: POST /api/revoke-member — Revoke a member's access.
 *
 * Authenticated via Bearer token (API key). Admin-only.
 * Prevents self-revocation (unless force=true) and last-admin revocation.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { extractBearerToken, authenticateApiKey } from '@/lib/api-auth';
import { jsonResponse, badRequest, unauthorized, forbidden, notFound } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    const apiKey = extractBearerToken(request);
    if (!apiKey) {
      return unauthorized();
    }

    const supabase = createServerClient();

    // Authenticate via shared helper
    const auth = await authenticateApiKey(supabase, apiKey);
    if (!auth) {
      return unauthorized();
    }

    // Parse body
    const body = await request.json();
    const targetMemberId: string | undefined = body.member_id;
    const force: boolean = body.force === true;

    if (!targetMemberId || typeof targetMemberId !== 'string') {
      return badRequest('member_id_required');
    }

    // Verify admin
    if (auth.role !== 'admin') {
      return forbidden('admin_required');
    }

    // Self-revocation guard
    if (targetMemberId === auth.memberId && !force) {
      return forbidden('cannot_revoke_self');
    }

    // Look up target member
    const { data: target, error: targetError } = await supabase
      .from('members')
      .select('id, org_id, author_name, revoked_at')
      .eq('id', targetMemberId)
      .eq('org_id', auth.orgId)
      .single();

    if (targetError || !target) {
      return notFound('member_not_found');
    }

    if (target.revoked_at) {
      return jsonResponse({ error: 'already_revoked' }, 409);
    }

    // Revoke
    const revokedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('members')
      .update({ revoked_at: revokedAt })
      .eq('id', targetMemberId);

    if (updateError) {
      return jsonResponse({ error: 'revoke_failed', message: updateError.message }, 500);
    }

    // Audit entry
    await supabase.from('audit_log').insert({
      org_id: auth.orgId,
      member_id: auth.memberId,
      action: 'member_revoked',
      target_type: 'member',
      target_id: targetMemberId,
      previous_state: { revoked_at: null },
      new_state: { revoked_at: revokedAt },
    });

    return jsonResponse({
      member_id: targetMemberId,
      revoked_at: revokedAt,
      revoked_by: auth.memberId,
    }, 200);
  } catch (err) {
    console.error('revoke-member error:', (err as Error).message);
    return jsonResponse({ error: 'revoke_failed', message: (err as Error).message }, 500);
  }
}
