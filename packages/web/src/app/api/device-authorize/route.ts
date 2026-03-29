import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse, badRequest } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { device_code } = body as { device_code?: string };

    if (!device_code) {
      return badRequest('device_code_required');
    }

    const supabase = createServerClient();

    const { data: code, error } = await supabase
      .from('device_codes')
      .select('id, status, expires_at, member_id, member_api_key')
      .eq('device_code', device_code)
      .single();

    if (error || !code) {
      return jsonResponse({ error: 'invalid_device_code' }, 404);
    }

    // Auto-expire
    if (code.status === 'pending' && new Date(code.expires_at) < new Date()) {
      await supabase
        .from('device_codes')
        .update({ status: 'expired' })
        .eq('id', code.id);
      return jsonResponse({ error: 'expired' }, 410);
    }

    switch (code.status) {
      case 'pending':
        return jsonResponse({ status: 'authorization_pending' }, 202);

      case 'approved': {
        // Fetch member + org details
        const { data: member } = await supabase
          .from('members')
          .select('id, author_name, org_id, role')
          .eq('id', code.member_id)
          .single();

        if (!member) {
          return jsonResponse({ error: 'member_not_found' }, 500);
        }

        const { data: org } = await supabase
          .from('orgs')
          .select('name')
          .eq('id', member.org_id)
          .single();

        return jsonResponse({
          member_api_key: code.member_api_key,
          member_id: member.id,
          author_name: member.author_name,
          org_id: member.org_id,
          org_name: org?.name ?? '',
          supabase_url: process.env.SUPABASE_URL ?? '',
          qdrant_url: process.env.QDRANT_URL ?? '',
          qdrant_api_key: '',
        }, 200);
      }

      case 'expired':
        return jsonResponse({ error: 'expired' }, 410);

      case 'denied':
        return jsonResponse({ error: 'denied' }, 403);

      default:
        return jsonResponse({ error: 'unknown_status' }, 500);
    }
  } catch (err) {
    console.error('device-authorize: error', (err as Error).message);
    return jsonResponse({ error: 'authorization_failed' }, 500);
  }
}
