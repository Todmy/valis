/**
 * POST /api/invite-member — Invite a member to a project by email.
 *
 * Authenticated via Supabase Auth Bearer token.
 * Only project_admin can invite.
 * Looks up the member by email (auth_user_id → members), then adds to project_members.
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

    // Verify the token with Supabase Auth to get the user
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !user) {
      return unauthorized();
    }

    // Parse body
    const body = await request.json();
    const { project_id, email } = body as { project_id?: string; email?: string };

    if (!project_id || typeof project_id !== 'string') {
      return badRequest('project_id_required');
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return badRequest('valid_email_required');
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Resolve the caller's member record
    const { data: callerMember, error: callerError } = await supabase
      .from('members')
      .select('id, org_id, role')
      .eq('auth_user_id', user.id)
      .is('revoked_at', null)
      .single();

    if (callerError || !callerMember) {
      return unauthorized('member_not_found');
    }

    // Verify the project belongs to the caller's org
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, org_id')
      .eq('id', project_id)
      .eq('org_id', callerMember.org_id)
      .single();

    if (projectError || !project) {
      return badRequest('project_not_found');
    }

    // Check that the caller is a project_admin for this project
    const { data: callerPM, error: callerPMError } = await supabase
      .from('project_members')
      .select('id, role')
      .eq('project_id', project_id)
      .eq('member_id', callerMember.id)
      .single();

    if (callerPMError || !callerPM || callerPM.role !== 'project_admin') {
      return forbidden('project_admin_required');
    }

    // Find member by email in the same org
    const { data: targetMember, error: targetMemberError } = await supabase
      .from('members')
      .select('id, author_name')
      .eq('email', trimmedEmail)
      .eq('org_id', callerMember.org_id)
      .is('revoked_at', null)
      .single();

    if (targetMemberError || !targetMember) {
      return jsonResponse({ error: 'user_not_found', message: `No organization member found with email ${trimmedEmail}` }, 404);
    }

    // Check if already a project member
    const { data: existingPM } = await supabase
      .from('project_members')
      .select('id')
      .eq('project_id', project_id)
      .eq('member_id', targetMember.id)
      .single();

    if (existingPM) {
      return jsonResponse({ error: 'already_member', message: `${trimmedEmail} is already a member of this project` }, 409);
    }

    // Add to project
    const { error: insertError } = await supabase.from('project_members').insert({
      project_id,
      member_id: targetMember.id,
      role: 'project_member',
    });

    if (insertError) {
      return jsonResponse({ error: 'invite_failed', message: insertError.message }, 500);
    }

    // Audit entry
    await supabase.from('audit_entries').insert({
      org_id: callerMember.org_id,
      member_id: callerMember.id,
      action: 'project_member_added',
      target_type: 'member',
      target_id: targetMember.id,
      new_state: { project_id, role: 'project_member' },
      project_id,
    });

    return jsonResponse({
      member_id: targetMember.id,
      author_name: targetMember.author_name,
      email: trimmedEmail,
      role: 'project_member',
      project_id,
    }, 200);
  } catch (err) {
    console.error('invite-member error:', (err as Error).message);
    return jsonResponse({ error: 'invite_failed', message: (err as Error).message }, 500);
  }
}
