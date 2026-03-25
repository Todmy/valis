/**
 * T018: Rotate key route.
 *
 * Admin-only endpoint. Rotates org key, member key, invite code,
 * or project invite code. Creates audit trail.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import {
  jsonResponse,
  unauthorized,
  forbidden,
  badRequest,
  notFound,
} from '@/lib/api-response';
import { extractBearerToken, authenticateApiKey } from '@/lib/api-auth';
import {
  generateOrgApiKey,
  generateMemberKey,
  generateInviteCode,
} from '@/lib/api-keys';

export async function POST(request: NextRequest) {
  try {
    const apiKey = extractBearerToken(request);
    if (!apiKey) {
      return unauthorized();
    }

    const body = await request.json();
    const { rotate, target_member_id, project_id } = body as {
      rotate?: string;
      target_member_id?: string;
      project_id?: string;
    };

    if (
      !rotate ||
      !['api_key', 'invite_code', 'member_key', 'project_invite_code'].includes(rotate)
    ) {
      return badRequest('invalid_target');
    }

    if (rotate === 'member_key' && !target_member_id) {
      return badRequest('member_id_required');
    }

    if (rotate === 'project_invite_code' && !project_id) {
      return badRequest('invalid_target');
    }

    const supabase = createServerClient();

    const auth = await authenticateApiKey(supabase, apiKey);
    if (!auth) {
      return unauthorized();
    }

    // Permission check
    if (rotate === 'project_invite_code') {
      if (auth.role !== 'admin') {
        const { data: pm, error: pmError } = await supabase
          .from('project_members')
          .select('role')
          .eq('project_id', project_id!)
          .eq('member_id', auth.memberId)
          .single();

        if (pmError || !pm || pm.role !== 'project_admin') {
          return forbidden('admin_required');
        }
      }
    } else if (auth.role !== 'admin') {
      return forbidden('admin_required');
    }

    let newValue: string;
    let returnTargetMemberId: string | null = null;
    let auditAction: string;
    let auditTargetType: string;
    let auditTargetId: string;

    if (rotate === 'api_key') {
      newValue = generateOrgApiKey();
      const { error: updateError } = await supabase
        .from('orgs')
        .update({ api_key: newValue })
        .eq('id', auth.orgId);

      if (updateError) {
        return jsonResponse({ error: 'rotation_failed', message: updateError.message }, 500);
      }

      auditAction = 'org_key_rotated';
      auditTargetType = 'org';
      auditTargetId = auth.orgId;
    } else if (rotate === 'invite_code') {
      newValue = generateInviteCode();
      const { error: updateError } = await supabase
        .from('orgs')
        .update({ invite_code: newValue })
        .eq('id', auth.orgId);

      if (updateError) {
        return jsonResponse({ error: 'rotation_failed', message: updateError.message }, 500);
      }

      auditAction = 'key_rotated';
      auditTargetType = 'org';
      auditTargetId = auth.orgId;
    } else if (rotate === 'project_invite_code') {
      const { data: proj, error: projError } = await supabase
        .from('projects')
        .select('id, org_id, invite_code')
        .eq('id', project_id!)
        .single();

      if (projError || !proj) {
        return notFound('project_not_found');
      }
      if (proj.org_id !== auth.orgId) {
        return notFound('project_not_found');
      }

      newValue = generateInviteCode();
      const { error: updateError } = await supabase
        .from('projects')
        .update({ invite_code: newValue })
        .eq('id', project_id!);

      if (updateError) {
        return jsonResponse({ error: 'rotation_failed', message: updateError.message }, 500);
      }

      auditAction = 'key_rotated';
      auditTargetType = 'project';
      auditTargetId = project_id!;
    } else {
      // member_key
      const { data: targetMember, error: targetError } = await supabase
        .from('members')
        .select('id, org_id, api_key')
        .eq('id', target_member_id!)
        .eq('org_id', auth.orgId)
        .is('revoked_at', null)
        .single();

      if (targetError || !targetMember) {
        return notFound('member_not_found');
      }

      newValue = generateMemberKey();
      returnTargetMemberId = target_member_id!;

      const { error: updateError } = await supabase
        .from('members')
        .update({ api_key: newValue })
        .eq('id', target_member_id!);

      if (updateError) {
        return jsonResponse({ error: 'rotation_failed', message: updateError.message }, 500);
      }

      auditAction = 'key_rotated';
      auditTargetType = 'member';
      auditTargetId = target_member_id!;
    }

    // Audit entry
    await supabase.from('audit_log').insert({
      org_id: auth.orgId,
      member_id: auth.memberId,
      action: auditAction,
      target_type: auditTargetType,
      target_id: auditTargetId,
      previous_state: {},
      new_state: { rotated: rotate },
    });

    return jsonResponse(
      {
        rotated: rotate,
        new_value: newValue,
        target_member_id: returnTargetMemberId,
        ...(rotate === 'project_invite_code' && project_id ? { project_id } : {}),
      },
      200,
    );
  } catch (err) {
    console.error('rotate-key error:', (err as Error).message);
    return jsonResponse(
      { error: 'rotation_failed', message: (err as Error).message },
      500,
    );
  }
}
