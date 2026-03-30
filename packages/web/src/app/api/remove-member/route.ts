/**
 * POST /api/remove-member — Remove a member from a project.
 *
 * Authenticated via Supabase Auth Bearer token.
 * Only project_admin can remove. Cannot remove self. Cannot remove last admin.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, badRequest, unauthorized, forbidden } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    // Extract Bearer token (Supabase Auth access token)
    const authHeader = request.headers.get('authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return unauthorized();
    }
    const accessToken = authHeader.slice(7).trim();
    if (!accessToken) {
      return unauthorized();
    }

    const supabase = createServerClient();

    // Verify the token with Supabase Auth
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !user) {
      return unauthorized();
    }

    // Parse body
    const body = await request.json();
    const { project_id, member_id } = body as { project_id?: string; member_id?: string };

    if (!project_id || typeof project_id !== 'string') {
      return badRequest('project_id_required');
    }
    if (!member_id || typeof member_id !== 'string') {
      return badRequest('member_id_required');
    }

    // Resolve the caller's member record
    const { data: callerMember, error: callerError } = await supabase
      .from('members')
      .select('id, org_id')
      .eq('auth_user_id', user.id)
      .is('revoked_at', null)
      .single();

    if (callerError || !callerMember) {
      return unauthorized('member_not_found');
    }

    // Verify project belongs to org
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, org_id')
      .eq('id', project_id)
      .eq('org_id', callerMember.org_id)
      .single();

    if (projectError || !project) {
      return badRequest('project_not_found');
    }

    // Check that the caller is a project_admin
    const { data: callerPM, error: callerPMError } = await supabase
      .from('project_members')
      .select('id, role')
      .eq('project_id', project_id)
      .eq('member_id', callerMember.id)
      .single();

    if (callerPMError || !callerPM || callerPM.role !== 'project_admin') {
      return forbidden('project_admin_required');
    }

    // Cannot remove self
    if (member_id === callerMember.id) {
      return forbidden('cannot_remove_self');
    }

    // Check the target is actually a member of this project
    const { data: targetPM, error: targetPMError } = await supabase
      .from('project_members')
      .select('id, role')
      .eq('project_id', project_id)
      .eq('member_id', member_id)
      .single();

    if (targetPMError || !targetPM) {
      return badRequest('not_a_project_member');
    }

    // If removing a project_admin, check they're not the last admin
    if (targetPM.role === 'project_admin') {
      const { count: adminCount } = await supabase
        .from('project_members')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project_id)
        .eq('role', 'project_admin');

      if ((adminCount ?? 0) <= 1) {
        return forbidden('cannot_remove_last_admin');
      }
    }

    // Remove from project
    const { error: deleteError } = await supabase
      .from('project_members')
      .delete()
      .eq('id', targetPM.id);

    if (deleteError) {
      return jsonResponse({ error: 'remove_failed', message: deleteError.message }, 500);
    }

    // Audit entry
    await supabase.from('audit_entries').insert({
      org_id: callerMember.org_id,
      member_id: callerMember.id,
      action: 'project_member_removed',
      target_type: 'member',
      target_id: member_id,
      previous_state: { project_id, role: targetPM.role },
      project_id,
    });

    return jsonResponse({
      removed_member_id: member_id,
      project_id,
    }, 200);
  } catch (err) {
    console.error('remove-member error:', (err as Error).message);
    return jsonResponse({ error: 'remove_failed', message: (err as Error).message }, 500);
  }
}
