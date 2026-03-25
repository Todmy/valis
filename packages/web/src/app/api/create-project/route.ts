/**
 * T020b: POST /api/create-project — Create a new project within an org.
 *
 * Authenticated via Bearer token (API key: tm_ or tmm_).
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { extractBearerToken } from '@/lib/api-auth';
import { generateInviteCode } from '@/lib/api-keys';
import { jsonResponse, badRequest, unauthorized, forbidden } from '@/lib/api-response';

const PLAN_PROJECT_LIMITS: Record<string, number> = {
  free: 1,
  team: 10,
  business: 50,
  enterprise: Infinity,
};

export async function POST(request: NextRequest) {
  try {
    // Extract Bearer token
    const apiKey = extractBearerToken(request);
    if (!apiKey) {
      return unauthorized();
    }

    // Parse request body
    const body = await request.json();
    const { org_id, project_name } = body as {
      org_id?: string;
      project_name?: string;
    };

    if (!project_name || typeof project_name !== 'string' || project_name.trim().length === 0) {
      return badRequest('project_name_required');
    }

    if (project_name.trim().length > 100) {
      return jsonResponse({ error: 'project_name_too_long' }, 400);
    }

    if (!org_id || typeof org_id !== 'string') {
      return badRequest('org_id_required');
    }

    const supabase = createServerClient();

    // Authenticate: resolve member from API key
    const isPerMemberKey = apiKey.startsWith('tmm_');
    const isOrgKey = apiKey.startsWith('tm_') && !isPerMemberKey;

    if (!isPerMemberKey && !isOrgKey) {
      return unauthorized();
    }

    let memberId: string;
    let memberOrgId: string;

    if (isPerMemberKey) {
      const { data: member, error: memberError } = await supabase
        .from('members')
        .select('id, org_id, role, revoked_at')
        .eq('api_key', apiKey)
        .is('revoked_at', null)
        .single();

      if (memberError || !member) {
        return unauthorized();
      }
      memberId = member.id;
      memberOrgId = member.org_id;
    } else {
      const { data: org, error: orgError } = await supabase
        .from('orgs')
        .select('id, api_key')
        .eq('api_key', apiKey)
        .single();

      if (orgError || !org) {
        return unauthorized();
      }

      const { data: admin, error: adminError } = await supabase
        .from('members')
        .select('id')
        .eq('org_id', org.id)
        .eq('role', 'admin')
        .is('revoked_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (adminError || !admin) {
        return unauthorized();
      }
      memberId = admin.id;
      memberOrgId = org.id;
    }

    // Verify member belongs to the specified org
    if (memberOrgId !== org_id) {
      return forbidden('insufficient_permissions');
    }

    // Check plan limits for max projects
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('plan')
      .eq('org_id', org_id)
      .eq('status', 'active')
      .limit(1)
      .single();

    const plan = subscription?.plan ?? 'free';
    const maxProjects = PLAN_PROJECT_LIMITS[plan] ?? 1;

    const { count: projectCount } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org_id);

    if ((projectCount ?? 0) >= maxProjects) {
      return forbidden('plan_limit_reached');
    }

    // Check project_name uniqueness within org
    const trimmedName = project_name.trim();

    const { data: existingProject } = await supabase
      .from('projects')
      .select('id')
      .eq('org_id', org_id)
      .ilike('name', trimmedName)
      .limit(1)
      .single();

    if (existingProject) {
      return jsonResponse({ error: 'project_name_exists' }, 409);
    }

    // Create project
    const projectId = crypto.randomUUID();
    const inviteCode = generateInviteCode();

    const { error: insertError } = await supabase.from('projects').insert({
      id: projectId,
      org_id,
      name: trimmedName,
      invite_code: inviteCode,
    });

    if (insertError) {
      console.error('create-project insert error:', insertError.message);
      return jsonResponse({ error: 'creation_failed' }, 500);
    }

    // Add creator as project_admin
    const { error: memberInsertError } = await supabase.from('project_members').insert({
      project_id: projectId,
      member_id: memberId,
      role: 'project_admin',
    });

    if (memberInsertError) {
      await supabase.from('projects').delete().eq('id', projectId);
      console.error('create-project member insert error:', memberInsertError.message);
      return jsonResponse({ error: 'creation_failed' }, 500);
    }

    // Audit entry
    await supabase.from('audit_entries').insert({
      org_id,
      member_id: memberId,
      action: 'project_created',
      target_type: 'project',
      target_id: projectId,
      previous_state: null,
      new_state: { project_name: trimmedName, invite_code: inviteCode },
      reason: null,
    });

    return jsonResponse({
      project_id: projectId,
      org_id,
      project_name: trimmedName,
      invite_code: inviteCode,
      role: 'project_admin',
    }, 201);
  } catch (err) {
    console.error('create-project error:', (err as Error).message);
    return jsonResponse({ error: 'creation_failed' }, 500);
  }
}
