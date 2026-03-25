/**
 * T009: Register route — creates org + member + project atomically.
 *
 * Public endpoint, rate-limited by IP (10/hour).
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse } from '@/lib/api-response';
import {
  generateOrgApiKey,
  generateMemberKey,
  generateInviteCode,
} from '@/lib/api-keys';

const NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9 \-]{0,98}[a-zA-Z0-9])?$/;

function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { org_name, project_name, author_name } = body as {
      org_name?: string;
      project_name?: string;
      author_name?: string;
    };

    if (!org_name || typeof org_name !== 'string' || org_name.trim().length === 0) {
      return jsonResponse({ error: 'org_name_required' }, 400);
    }
    if (!project_name || typeof project_name !== 'string' || project_name.trim().length === 0) {
      return jsonResponse({ error: 'project_name_required' }, 400);
    }
    if (!author_name || typeof author_name !== 'string' || author_name.trim().length === 0) {
      return jsonResponse({ error: 'author_name_required' }, 400);
    }

    const trimmedOrgName = org_name.trim();
    const trimmedProjectName = project_name.trim();
    const trimmedAuthorName = author_name.trim();

    if (!isValidName(trimmedOrgName)) {
      return jsonResponse({ error: 'invalid_name', field: 'org_name' }, 400);
    }
    if (!isValidName(trimmedProjectName)) {
      return jsonResponse({ error: 'invalid_name', field: 'project_name' }, 400);
    }
    if (trimmedAuthorName.length < 1 || trimmedAuthorName.length > 100) {
      return jsonResponse({ error: 'invalid_name', field: 'author_name' }, 400);
    }

    const supabase = createServerClient();

    // Rate limit: max 10 per IP per hour
    const clientIp = getClientIp(request);
    const { count: rateLimitCount, error: rlError } = await supabase
      .from('registration_rate_limits')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', clientIp)
      .gte('created_at', new Date(Date.now() - 3600_000).toISOString());

    if (rlError) {
      return jsonResponse({ error: 'creation_failed', message: 'rate limit check failed' }, 500);
    }
    if ((rateLimitCount ?? 0) >= 10) {
      return jsonResponse({ error: 'rate_limit_exceeded' }, 429);
    }

    // Check org name uniqueness
    const { data: existingOrg } = await supabase
      .from('orgs')
      .select('id')
      .ilike('name', trimmedOrgName)
      .limit(1)
      .single();

    if (existingOrg) {
      return jsonResponse({ error: 'org_name_taken' }, 409);
    }

    // Generate keys and IDs
    const orgId = crypto.randomUUID();
    const orgApiKey = generateOrgApiKey();
    const orgInviteCode = generateInviteCode();
    const memberApiKey = generateMemberKey();
    const projectInviteCode = generateInviteCode();
    const projectId = crypto.randomUUID();

    // Atomic inserts with manual rollback
    const { error: orgError } = await supabase.from('orgs').insert({
      id: orgId,
      name: trimmedOrgName,
      api_key: orgApiKey,
      invite_code: orgInviteCode,
    });

    if (orgError) {
      return jsonResponse({ error: 'creation_failed', message: orgError.message }, 500);
    }

    const { data: memberData, error: memberError } = await supabase
      .from('members')
      .insert({
        org_id: orgId,
        author_name: trimmedAuthorName,
        role: 'admin',
        api_key: memberApiKey,
      })
      .select('id')
      .single();

    if (memberError || !memberData) {
      await supabase.from('orgs').delete().eq('id', orgId);
      return jsonResponse({ error: 'creation_failed', message: memberError?.message ?? 'member insert failed' }, 500);
    }

    const memberId = memberData.id;

    const { error: projectError } = await supabase.from('projects').insert({
      id: projectId,
      org_id: orgId,
      name: trimmedProjectName,
      invite_code: projectInviteCode,
    });

    if (projectError) {
      await supabase.from('members').delete().eq('id', memberId);
      await supabase.from('orgs').delete().eq('id', orgId);
      return jsonResponse({ error: 'creation_failed', message: projectError.message }, 500);
    }

    const { error: pmError } = await supabase.from('project_members').insert({
      project_id: projectId,
      member_id: memberId,
      role: 'project_admin',
    });

    if (pmError) {
      await supabase.from('projects').delete().eq('id', projectId);
      await supabase.from('members').delete().eq('id', memberId);
      await supabase.from('orgs').delete().eq('id', orgId);
      return jsonResponse({ error: 'creation_failed', message: pmError.message }, 500);
    }

    // Audit (best-effort)
    try {
      await supabase.from('audit_entries').insert([
        {
          org_id: orgId,
          member_id: memberId,
          action: 'org_created',
          target_type: 'org',
          target_id: orgId,
          previous_state: null,
          new_state: { name: trimmedOrgName },
          reason: 'Registration API',
        },
      ]);
    } catch {
      // Non-fatal
    }

    // Record rate limit entry
    await supabase.from('registration_rate_limits').insert({ ip_address: clientIp });

    const publicSupabaseUrl = process.env.SUPABASE_URL!;
    const qdrantUrl = process.env.QDRANT_URL ?? '';

    return jsonResponse(
      {
        member_api_key: memberApiKey,
        supabase_url: publicSupabaseUrl,
        qdrant_url: qdrantUrl,
        qdrant_api_key: process.env.QDRANT_API_KEY || '',
        org_id: orgId,
        org_name: trimmedOrgName,
        project_id: projectId,
        project_name: trimmedProjectName,
        invite_code: projectInviteCode,
        member_id: memberId,
      },
      201,
    );
  } catch (err) {
    console.error('register error:', (err as Error).message);
    return jsonResponse({ error: 'creation_failed', message: (err as Error).message }, 500);
  }
}
