/**
 * T010: Join project via invite code.
 *
 * Public endpoint. Looks up project by invite_code, creates or reuses
 * org member, adds to project_members.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse } from '@/lib/api-response';
import { generateMemberKey } from '@/lib/api-keys';

const PLAN_MEMBER_LIMITS: Record<string, number> = {
  free: 5,
  team: 25,
  business: 50,
  enterprise: 500,
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invite_code, author_name } = body as {
      invite_code?: string;
      author_name?: string;
    };

    if (!invite_code || typeof invite_code !== 'string' || invite_code.trim().length === 0) {
      return jsonResponse({ error: 'invite_code_required' }, 400);
    }
    if (!author_name || typeof author_name !== 'string' || author_name.trim().length === 0) {
      return jsonResponse({ error: 'author_name_required' }, 400);
    }

    const supabase = createServerClient();

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, org_id, name, invite_code')
      .ilike('invite_code', invite_code.trim())
      .single();

    if (projectError || !project) {
      return jsonResponse({ error: 'invalid_invite_code' }, 404);
    }

    const orgId = project.org_id;

    const { data: org, error: orgError } = await supabase
      .from('orgs')
      .select('id, name')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      return jsonResponse({ error: 'join_failed' }, 500);
    }

    // Check member limit
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('plan')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .limit(1)
      .single();

    const plan = subscription?.plan ?? 'free';
    const maxMembers = PLAN_MEMBER_LIMITS[plan] ?? 5;

    const { count: memberCount } = await supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .is('revoked_at', null);

    const currentMemberCount = memberCount ?? 0;

    // Check if author already exists
    const trimmedAuthor = author_name.trim();
    const { data: existingMember } = await supabase
      .from('members')
      .select('id, api_key, role')
      .eq('org_id', orgId)
      .eq('author_name', trimmedAuthor)
      .is('revoked_at', null)
      .single();

    let memberId: string;
    let memberKey: string | null;
    let isNewOrgMember = false;

    if (existingMember) {
      memberId = existingMember.id;
      memberKey = existingMember.api_key ?? null;

      const { data: existingPM } = await supabase
        .from('project_members')
        .select('id')
        .eq('project_id', project.id)
        .eq('member_id', memberId)
        .single();

      if (existingPM) {
        return jsonResponse({ error: 'already_member' }, 409);
      }
    } else {
      if (currentMemberCount >= maxMembers) {
        return jsonResponse({ error: 'member_limit_reached' }, 403);
      }

      memberKey = generateMemberKey();
      const { data: newMember, error: newMemberError } = await supabase
        .from('members')
        .insert({
          org_id: orgId,
          author_name: trimmedAuthor,
          role: 'member',
          api_key: memberKey,
        })
        .select('id')
        .single();

      if (newMemberError || !newMember) {
        return jsonResponse({ error: 'join_failed' }, 500);
      }

      memberId = newMember.id;
      isNewOrgMember = true;
    }

    // Add to project_members
    const { error: pmError } = await supabase.from('project_members').insert({
      project_id: project.id,
      member_id: memberId,
      role: 'project_member',
    });

    if (pmError) {
      return jsonResponse({ error: 'join_failed' }, 500);
    }

    // Decision count
    const { count: decisionCount } = await supabase
      .from('decisions')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project.id);

    const publicSupabaseUrl = process.env.SUPABASE_URL ?? '';
    const publicQdrantUrl = process.env.QDRANT_URL ?? '';

    return jsonResponse(
      {
        org_id: orgId,
        org_name: org.name,
        project_id: project.id,
        project_name: project.name,
        member_api_key: memberKey,
        member_id: memberId,
        supabase_url: publicSupabaseUrl,
        qdrant_url: publicQdrantUrl,
        qdrant_api_key: '',
        member_count: currentMemberCount + (isNewOrgMember ? 1 : 0),
        decision_count: decisionCount ?? 0,
        role: 'project_member',
      },
      200,
    );
  } catch (err) {
    console.error('join-project error:', (err as Error).message);
    return jsonResponse({ error: 'join_failed' }, 500);
  }
}
