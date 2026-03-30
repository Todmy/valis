/**
 * POST /api/invite-member — Invite a member to a project by email.
 *
 * Auth: Supabase Auth session (Bearer token).
 * Creates member + auth user if email is new.
 * Sends notification email via Resend.
 */

import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, badRequest, unauthorized } from '@/lib/api-response';
import { generateMemberKey } from '@/lib/api-keys';
import { getResendClient } from '@/lib/resend';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return unauthorized();

    const supabase = createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !user?.email) return unauthorized('Invalid session');

    const body = await request.json();
    const { project_id, email } = body as { project_id?: string; email?: string };

    if (!project_id) return badRequest('project_id required');
    if (!email || !EMAIL_RE.test(email.trim())) return badRequest('invalid_email');

    const trimmedEmail = email.trim().toLowerCase();

    // Get caller's member record
    const { data: caller } = await supabase
      .from('members')
      .select('id, org_id, author_name')
      .eq('email', user.email)
      .is('revoked_at', null)
      .single();

    if (!caller) return unauthorized('No member account');

    // Verify project exists and belongs to caller's org
    const { data: project } = await supabase
      .from('projects')
      .select('id, name, org_id')
      .eq('id', project_id)
      .single();

    if (!project || project.org_id !== caller.org_id) {
      return jsonResponse({ error: 'project_not_found' }, 404);
    }

    // Check caller is project admin
    const { data: callerRole } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', project_id)
      .eq('member_id', caller.id)
      .single();

    if (!callerRole || callerRole.role !== 'project_admin') {
      return jsonResponse({ error: 'not_project_admin' }, 403);
    }

    // Rate limit: 10 invitations per hour per project
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count: recentCount } = await supabase
      .from('project_members')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project_id)
      .gte('joined_at', oneHourAgo);

    if ((recentCount ?? 0) >= 10) {
      return jsonResponse({ error: 'rate_limit_exceeded', message: 'Max 10 invitations per hour' }, 429);
    }

    // Find or create member by email
    let memberId: string;
    let memberName: string;
    let isNewUser = false;

    const { data: existingMember } = await supabase
      .from('members')
      .select('id, author_name')
      .eq('email', trimmedEmail)
      .is('revoked_at', null)
      .maybeSingle();

    if (existingMember) {
      memberId = existingMember.id;
      memberName = existingMember.author_name;
    } else {
      // Create new member in the project's org
      isNewUser = true;
      memberName = trimmedEmail.split('@')[0];

      const { data: newMember, error: createErr } = await supabase
        .from('members')
        .insert({
          org_id: project.org_id,
          author_name: memberName,
          role: 'member',
          api_key: generateMemberKey(),
          email: trimmedEmail,
        })
        .select('id')
        .single();

      if (createErr || !newMember) {
        console.error('invite-member: member creation failed', createErr?.message);
        return jsonResponse({ error: 'creation_failed' }, 500);
      }

      memberId = newMember.id;

      // Create Supabase Auth user (non-critical)
      try {
        const { data: authUser } = await supabase.auth.admin.createUser({
          email: trimmedEmail,
          email_confirm: true,
        });
        if (authUser?.user?.id) {
          await supabase.from('members').update({ auth_user_id: authUser.user.id }).eq('id', memberId);
        }
      } catch (e) {
        console.error('invite-member: auth user creation failed', (e as Error).message);
      }
    }

    // Check if already a member of this project
    const { data: existingPM } = await supabase
      .from('project_members')
      .select('id')
      .eq('project_id', project_id)
      .eq('member_id', memberId)
      .maybeSingle();

    if (existingPM) {
      return jsonResponse({ error: 'already_member' }, 409);
    }

    // Add to project
    const { error: pmError } = await supabase.from('project_members').insert({
      project_id,
      member_id: memberId,
      role: 'project_member',
    });

    if (pmError) {
      return jsonResponse({ error: 'invite_failed', message: pmError.message }, 500);
    }

    // Send email via Resend (non-critical)
    try {
      const resend = getResendClient();
      const subject = isNewUser
        ? `You've been invited to ${project.name} on Valis`
        : `You've been added to ${project.name} on Valis`;

      await resend.emails.send({
        from: 'Valis <noreply@valis.krukit.co>',
        to: trimmedEmail,
        subject,
        html: `
          <div style="background:#0a0a0f;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px 20px;max-width:500px;margin:0 auto;">
            <h1 style="color:#60a5fa;font-size:24px;margin-bottom:24px;">Valis</h1>
            <p style="font-size:16px;line-height:1.6;">${isNewUser ? `You've been invited to join <strong>${project.name}</strong>` : `You've been added to <strong>${project.name}</strong>`}</p>
            <p style="font-size:14px;color:#9ca3af;margin-top:8px;">Invited by ${caller.author_name}</p>
            <a href="https://valis.krukit.co/auth/login" style="display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;margin-top:24px;">Log in to Valis</a>
            <p style="font-size:12px;color:#6b7280;margin-top:32px;border-top:1px solid #1f2937;padding-top:16px;">You received this email because someone invited you to a Valis project.</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('invite-member: email failed', (emailErr as Error).message);
    }

    return jsonResponse({
      status: 'invited',
      member_name: memberName,
      is_new_user: isNewUser,
    }, isNewUser ? 201 : 200);
  } catch (err) {
    console.error('invite-member: error', (err as Error).message);
    return jsonResponse({ error: 'invite_failed' }, 500);
  }
}
