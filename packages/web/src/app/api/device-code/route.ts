import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse } from '@/lib/api-response';

function generateUserCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O (ambiguous)
  const code = Array.from({ length: 4 }, () =>
    letters[Math.floor(Math.random() * letters.length)],
  ).join('');
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${code}-${digits}`;
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const clientIp = getClientIp(request);

    // Rate limit: 3 per IP per hour
    const { count, error: rlError } = await supabase
      .from('device_codes')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', clientIp)
      .gte('created_at', new Date(Date.now() - 3600_000).toISOString());

    if (rlError) {
      return jsonResponse({ error: 'rate_limit_check_failed' }, 500);
    }
    if ((count ?? 0) >= 3) {
      return jsonResponse({ error: 'rate_limit_exceeded' }, 429);
    }

    const userCode = generateUserCode();
    const deviceCode = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase.from('device_codes').insert({
      user_code: userCode,
      device_code: deviceCode,
      expires_at: expiresAt,
      ip_address: clientIp,
    });

    if (insertErr) {
      // Retry once on user_code collision
      const retryCode = generateUserCode();
      const { error: retryErr } = await supabase.from('device_codes').insert({
        user_code: retryCode,
        device_code: crypto.randomUUID(),
        expires_at: expiresAt,
        ip_address: clientIp,
      });
      if (retryErr) {
        return jsonResponse({ error: 'creation_failed' }, 500);
      }
      return jsonResponse({
        user_code: retryCode,
        device_code: deviceCode,
        verification_url: `https://valis.krukit.co/auth/device?code=${retryCode}`,
        expires_in: 900,
        interval: 5,
      }, 201);
    }

    return jsonResponse({
      user_code: userCode,
      device_code: deviceCode,
      verification_url: `https://valis.krukit.co/auth/device?code=${userCode}`,
      expires_in: 900,
      interval: 5,
    }, 201);
  } catch (err) {
    return jsonResponse({ error: 'creation_failed', message: (err as Error).message }, 500);
  }
}
