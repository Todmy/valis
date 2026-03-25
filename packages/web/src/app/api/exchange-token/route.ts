/**
 * T013: Exchange API key for JWT.
 *
 * Security-critical route. Validates API key (tmm_ or tm_),
 * resolves member/org, mints HS256 JWT with 1h TTL.
 */

import { type NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, unauthorized } from '@/lib/api-response';
import { extractBearerToken, authenticateApiKey } from '@/lib/api-auth';

export async function POST(request: NextRequest) {
  try {
    const apiKey = extractBearerToken(request);
    if (!apiKey) {
      return unauthorized();
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET env var is not configured');
      return jsonResponse({ error: 'token_generation_failed' }, 500);
    }

    const supabase = createServerClient();
    const auth = await authenticateApiKey(supabase, apiKey);
    if (!auth) {
      return unauthorized();
    }

    // Fetch org name
    const { data: org } = await supabase
      .from('orgs')
      .select('name')
      .eq('id', auth.orgId)
      .single();

    const orgName = org?.name ?? '';

    // Parse optional project_id
    let projectId: string | undefined;
    let projectName: string | undefined;
    let projectRole: string | undefined;

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine
    }

    if (body.project_id && typeof body.project_id === 'string') {
      const requestedProjectId = body.project_id;

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id, org_id, name')
        .eq('id', requestedProjectId)
        .single();

      if (projectError || !project || project.org_id !== auth.orgId) {
        return jsonResponse({ error: 'project_access_denied' }, 403);
      }

      if (auth.role !== 'admin') {
        const { data: pm, error: pmError } = await supabase
          .from('project_members')
          .select('role')
          .eq('project_id', requestedProjectId)
          .eq('member_id', auth.memberId)
          .single();

        if (pmError || !pm) {
          return jsonResponse({ error: 'project_access_denied' }, 403);
        }
        projectRole = pm.role;
      } else {
        const { data: pm } = await supabase
          .from('project_members')
          .select('role')
          .eq('project_id', requestedProjectId)
          .eq('member_id', auth.memberId)
          .single();
        projectRole = pm?.role ?? 'project_admin';
      }

      projectId = project.id;
      projectName = project.name;
    }

    // Mint JWT
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600;
    const secret = new TextEncoder().encode(jwtSecret);

    const jwtClaims: Record<string, unknown> = {
      sub: auth.memberId,
      role: 'authenticated',
      iss: 'valis',
      org_id: auth.orgId,
      member_role: auth.role,
      author_name: auth.authorName,
      hosted: true,
    };

    if (projectId) {
      jwtClaims.project_id = projectId;
      jwtClaims.project_role = projectRole;
    }

    const token = await new SignJWT(jwtClaims)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(secret);

    const expiresAt = new Date(exp * 1000).toISOString();

    const responseBody: Record<string, unknown> = {
      token,
      expires_at: expiresAt,
      member_id: auth.memberId,
      org_id: auth.orgId,
      org_name: orgName,
      role: auth.role,
      author_name: auth.authorName,
      auth_mode: 'jwt',
    };

    if (projectId) {
      responseBody.project_id = projectId;
      responseBody.project_name = projectName;
      responseBody.project_role = projectRole;
    }

    return jsonResponse(responseBody, 200);
  } catch (err) {
    console.error('exchange-token error:', (err as Error).message);
    return jsonResponse({ error: 'token_generation_failed' }, 500);
  }
}
