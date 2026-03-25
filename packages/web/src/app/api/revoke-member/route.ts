/**
 * T019: POST /api/revoke-member — Revoke a member's access.
 *
 * Authenticated via Bearer token (API key). Admin-only.
 * Prevents self-revocation (unless force=true) and last-admin revocation.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { extractBearerToken } from '@/lib/api-auth';
import { jsonResponse, badRequest, unauthorized, forbidden, notFound } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    const apiKey = extractBearerToken(request);
    if (!apiKey) {
      return unauthorized();
    }

    // Parse body
    const body = await request.json();
    const targetMemberId: string | undefined = body.member_id;
    const force: boolean = body.force === true;

    if (!targetMemberId || typeof targetMemberId !== 'string') {
      return badRequest('member_id_required');
    }

    const supabase = createServerClient();

    // Authenticate caller
    let callerId: string;
    let callerOrgId: string;
    let callerRole: string;

    const isPerMemberKey = apiKey.startsWith('tmm_');
    const isOrgKey = apiKey.startsWith('tm_') && !isPerMemberKey;

    if (isPerMemberKey) {
      const { data: member, error: memberError } = await supabase
        .from('members')
        .select('id, org_id, role, api_key, revoked_at')
        .eq('api_key', apiKey)
        .is('revoked_at', null)
        .single();

      if (memberError || !member) return unauthorized();

      callerId = member.id;
      callerOrgId = member.org_id;
      callerRole = member.role;
    } else if (isOrgKey) {
      const { data: org, error: orgError } = await supabase
        .from('orgs')
        .select('id, api_key')
        .eq('api_key', apiKey)
        .single();

      if (orgError || !org) return unauthorized();

      const { data: admin, error: adminError } = await supabase
        .from('members')
        .select('id, role')
        .eq('org_id', org.id)
        .eq('role', 'admin')
        .is('revoked_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (adminError || !admin) return unauthorized();

      callerId = admin.id;
      callerOrgId = org.id;
      callerRole = admin.role;
    } else {
      return unauthorized();
    }

    // Verify admin
    if (callerRole !== 'admin') {
      return forbidden('admin_required');
    }

    // Self-revocation guard
    if (targetMemberId === callerId && !force) {
      return jsonResponse({
        error: 'self_revoke_warning',
        message: 'You are about to revoke your own access. Pass force: true to confirm.',
      }, 409);
    }

    // Look up target member
    const { data: target, error: targetError } = await supabase
      .from('members')
      .select('id, org_id, author_name, revoked_at')
      .eq('id', targetMemberId)
      .eq('org_id', callerOrgId)
      .single();

    if (targetError || !target) {
      return notFound('member_not_found');
    }

    if (target.revoked_at) {
      return jsonResponse({ error: 'already_revoked' }, 409);
    }

    // Revoke
    const { error: updateError } = await supabase
      .from('members')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', targetMemberId);

    if (updateError) {
      return jsonResponse({ error: 'revoke_failed', message: updateError.message }, 500);
    }

    // Audit entry
    await supabase.from('audit_log').insert({
      org_id: callerOrgId,
      member_id: callerId,
      action: 'member_revoked',
      target_type: 'member',
      target_id: targetMemberId,
      previous_state: { revoked_at: null },
      new_state: { revoked_at: new Date().toISOString() },
    });

    return jsonResponse({
      revoked: true,
      member_id: targetMemberId,
      author_name: target.author_name,
    }, 200);
  } catch (err) {
    console.error('revoke-member error:', (err as Error).message);
    return jsonResponse({ error: 'revoke_failed', message: (err as Error).message }, 500);
  }
}
