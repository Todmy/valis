/**
 * T020: POST /api/seed — Seed decisions server-side.
 *
 * Authenticated via Bearer token (per-member or org API key).
 * Stores decisions to both Postgres and Qdrant.
 * Deduplicates by content_hash.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { extractBearerToken } from '@/lib/api-auth';
import { jsonResponse, badRequest, unauthorized } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    // Authenticate via Bearer token
    const token = extractBearerToken(request);
    if (!token) {
      return unauthorized();
    }

    const supabase = createServerClient();
    const qdrantUrl = process.env.QDRANT_URL || '';
    const qdrantApiKey = process.env.QDRANT_API_KEY || '';

    // Resolve member from API key
    const isPerMember = token.startsWith('tmm_');
    let orgId: string;
    let memberId: string;
    let authorName: string;

    if (isPerMember) {
      const { data: member, error: memberErr } = await supabase
        .from('members')
        .select('id, org_id, author_name, revoked_at')
        .eq('api_key', token)
        .is('revoked_at', null)
        .single();

      if (memberErr || !member) {
        return unauthorized();
      }
      orgId = member.org_id;
      memberId = member.id;
      authorName = member.author_name;
    } else {
      const { data: org, error: orgErr } = await supabase
        .from('orgs')
        .select('id')
        .eq('api_key', token)
        .single();

      if (orgErr || !org) {
        return unauthorized();
      }

      const { data: admin } = await supabase
        .from('members')
        .select('id, author_name')
        .eq('org_id', org.id)
        .eq('role', 'admin')
        .order('joined_at', { ascending: true })
        .limit(1)
        .single();

      orgId = org.id;
      memberId = admin?.id || 'unknown';
      authorName = admin?.author_name || 'system';
    }

    // Parse request body
    const body = await request.json();
    const { decisions, project_id } = body as {
      decisions: Array<{
        text: string;
        type?: string;
        summary?: string;
        affects?: string[];
      }>;
      project_id: string;
    };

    if (!project_id) {
      return badRequest('project_id_required');
    }

    if (!Array.isArray(decisions) || decisions.length === 0) {
      return badRequest('decisions_required');
    }

    // Verify the target project belongs to the caller's org
    const { data: project } = await supabase
      .from('projects')
      .select('org_id')
      .eq('id', project_id)
      .single();
    if (!project || project.org_id !== orgId) {
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
    }

    // Verify member has access to the requested project
    const { data: projectAccess } = await supabase
      .from('project_members')
      .select('id')
      .eq('project_id', project_id)
      .eq('member_id', memberId)
      .limit(1)
      .maybeSingle();

    if (!projectAccess) {
      const { data: member } = await supabase
        .from('members')
        .select('role')
        .eq('id', memberId)
        .single();

      if (!member || member.role !== 'admin') {
        return jsonResponse(
          { error: 'no_project_access', message: 'You do not have access to this project' },
          403,
        );
      }
    }

    // Limit: max 100 decisions per seed call
    const toProcess = decisions.slice(0, 100);

    let stored = 0;
    let skipped = 0;

    for (const d of toProcess) {
      if (!d.text || d.text.length < 10) {
        skipped++;
        continue;
      }

      // Generate content hash for dedup
      const normalized = d.text.trim().toLowerCase().replace(/\s+/g, ' ');
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(normalized));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      const decisionId = crypto.randomUUID();
      const decisionType = d.type || 'pending';
      const affects = d.affects || [];

      const { error: insertErr } = await supabase.from('decisions').insert({
        id: decisionId,
        org_id: orgId,
        project_id: project_id,
        type: decisionType,
        summary: d.summary || null,
        detail: d.text,
        status: 'active',
        author: authorName,
        source: 'seed',
        content_hash: hash,
        affects,
        pinned: false,
      });

      if (insertErr) {
        skipped++;
      } else {
        stored++;

        // Upsert to Qdrant (best-effort)
        if (qdrantUrl && qdrantApiKey) {
          try {
            await fetch(`${qdrantUrl}/collections/decisions/points`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'api-key': qdrantApiKey,
              },
              body: JSON.stringify({
                points: [{
                  id: decisionId,
                  vector: new Array(384).fill(0),
                  payload: {
                    org_id: orgId,
                    project_id: project_id,
                    type: decisionType,
                    summary: d.summary || '',
                    detail: d.text,
                    author: authorName,
                    source: 'seed',
                    affects,
                    status: 'active',
                    pinned: false,
                    confidence: null,
                    created_at: new Date().toISOString(),
                  },
                }],
              }),
            });
          } catch {
            // Qdrant failure non-critical during seed
          }
        }
      }
    }

    return jsonResponse({ stored, skipped, total: toProcess.length }, 200);
  } catch (err) {
    return jsonResponse(
      { error: 'seed_failed', message: (err as Error).message },
      500,
    );
  }
}
