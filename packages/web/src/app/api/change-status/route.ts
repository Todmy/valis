/**
 * T017: POST /api/change-status -- Change decision status.
 *
 * Authenticated via Bearer token (API key or JWT). Validates transitions,
 * creates audit log, resolves contradictions.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, unauthorized } from '@/lib/api-response';
import {
  extractBearerToken,
  authenticateApiKey,
  decodeJwtPayload,
} from '@/lib/api-auth';

const VALID_TRANSITIONS: Record<string, string[]> = {
  proposed: ['active'],
  active: ['deprecated', 'superseded'],
};

const AUDIT_ACTIONS: Record<string, string> = {
  active: 'decision_promoted',
  deprecated: 'decision_deprecated',
  superseded: 'decision_superseded',
};

export async function POST(request: NextRequest) {
  try {
    const bearerToken = extractBearerToken(request);
    if (!bearerToken) {
      return unauthorized();
    }

    const supabase = createServerClient();

    let memberId: string;
    let orgId: string;
    let memberRole: string;
    let authorName: string;
    let projectId: string | undefined;
    let projectRole: string | undefined;

    // Check if JWT or API key
    const isJwt =
      bearerToken.split('.').length === 3 &&
      !bearerToken.startsWith('tm_') &&
      !bearerToken.startsWith('tmm_');

    if (isJwt) {
      const claims = decodeJwtPayload(bearerToken);
      memberId = claims.sub as string;
      orgId = claims.org_id as string;
      memberRole = claims.member_role as string;
      authorName = claims.author_name as string;
      projectId = claims.project_id as string | undefined;
      projectRole = claims.project_role as string | undefined;

      if (!memberId || !orgId || !memberRole || !authorName) {
        return unauthorized();
      }
    } else {
      const auth = await authenticateApiKey(supabase, bearerToken);
      if (!auth) {
        return unauthorized();
      }
      memberId = auth.memberId;
      orgId = auth.orgId;
      memberRole = auth.role;
      authorName = auth.authorName;
    }

    const { decision_id, new_status, reason } = await request.json();

    if (!decision_id || typeof decision_id !== 'string') {
      return jsonResponse({ error: 'decision_id_required' }, 400);
    }

    if (
      !new_status ||
      !['active', 'deprecated', 'superseded'].includes(new_status)
    ) {
      return jsonResponse({ error: 'invalid_status' }, 400);
    }

    // Load decision, verify same org
    const { data: decision, error: decisionError } = await supabase
      .from('decisions')
      .select('id, org_id, project_id, status, author_name')
      .eq('id', decision_id)
      .single();

    if (decisionError || !decision) {
      return jsonResponse({ error: 'decision_not_found' }, 404);
    }

    if (decision.org_id !== orgId) {
      return jsonResponse({ error: 'decision_not_found' }, 404);
    }

    // Project scope check
    if (
      projectId &&
      decision.project_id &&
      decision.project_id !== projectId
    ) {
      return jsonResponse({ error: 'project_access_denied' }, 403);
    }

    // Validate transition
    const oldStatus: string = decision.status;
    const allowedTransitions = VALID_TRANSITIONS[oldStatus];

    if (!allowedTransitions || !allowedTransitions.includes(new_status)) {
      return jsonResponse({ error: 'invalid_transition' }, 400);
    }

    // Permission check for supersede
    if (new_status === 'superseded') {
      const isOrgAdmin = memberRole === 'admin';
      const isProjectAdmin = projectRole === 'project_admin';
      const isOriginalAuthor = authorName === decision.author_name;

      if (!isOrgAdmin && !isProjectAdmin && !isOriginalAuthor) {
        return jsonResponse({ error: 'insufficient_permissions' }, 403);
      }
    }

    // Update decision status
    const { error: updateError } = await supabase
      .from('decisions')
      .update({
        status: new_status,
        status_changed_by: authorName,
        status_changed_at: new Date().toISOString(),
        status_reason: reason || null,
      })
      .eq('id', decision_id);

    if (updateError) {
      return jsonResponse(
        { error: 'update_failed', message: updateError.message },
        500,
      );
    }

    // If deprecated: find dependents
    let flaggedDependents: string[] = [];
    if (new_status === 'deprecated') {
      const { data: dependents } = await supabase
        .from('decisions')
        .select('id')
        .eq('org_id', orgId)
        .contains('depends_on', [decision_id]);

      if (dependents && dependents.length > 0) {
        flaggedDependents = dependents.map(
          (d: { id: string }) => d.id,
        );
      }
    }

    // Resolve open contradictions
    if (new_status === 'deprecated' || new_status === 'superseded') {
      await supabase
        .from('contradictions')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: memberId,
        })
        .or(
          `decision_a_id.eq.${decision_id},decision_b_id.eq.${decision_id}`,
        )
        .eq('status', 'open');
    }

    // Create audit entry
    const auditAction = AUDIT_ACTIONS[new_status];
    await supabase.from('audit_entries').insert({
      org_id: orgId,
      member_id: memberId,
      action: auditAction,
      target_type: 'decision',
      target_id: decision_id,
      previous_state: { status: oldStatus },
      new_state: { status: new_status },
      reason: reason || null,
      ...(projectId ? { project_id: projectId } : {}),
    });

    return jsonResponse(
      {
        decision_id,
        old_status: oldStatus,
        new_status,
        changed_by: authorName,
        member_id: memberId,
      },
      200,
    );
  } catch (err) {
    console.error('change-status error:', (err as Error).message);
    return jsonResponse(
      { error: 'update_failed', message: (err as Error).message },
      500,
    );
  }
}
