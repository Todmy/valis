import { type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { jsonResponse } from '@/lib/api-response';

function generateUserCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O (ambiguous)
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes.slice(0, 4), (b) =>
    letters[b % letters.length],
  ).join('');
  const num = ((bytes[4] << 24 | bytes[5] << 16 | bytes[6] << 8 | bytes[7]) >>> 0) % 9000 + 1000;
  return `${code}-${num}`;
}

function getClientIp(request: NextRequest): string {
  // Vercel sets request.ip reliably; fall back to rightmost x-forwarded-for
  if ('ip' in request && typeof (request as Record<string, unknown>).ip === 'string') {
    return (request as Record<string, unknown>).ip as string;
  }
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',');
    return parts[parts.length - 1].trim(); // last = Vercel edge-injected
  }
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
      console.error('device-code: rate limit check failed', rlError.message);
      return jsonResponse({ error: 'rate_limit_check_failed' }, 500);
    }
    if ((count ?? 0) >= 3) {
      return jsonResponse({ error: 'rate_limit_exceeded' }, 429);
    }

    // Generate codes
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
      // Retry once on user_code collision with fresh codes
      const retryUserCode = generateUserCode();
      const retryDeviceCode = crypto.randomUUID();
      const { error: retryErr } = await supabase.from('device_codes').insert({
        user_code: retryUserCode,
        device_code: retryDeviceCode,
        expires_at: expiresAt,
        ip_address: clientIp,
      });
      if (retryErr) {
        console.error('device-code: insert failed after retry', retryErr.message);
        return jsonResponse({ error: 'creation_failed' }, 500);
      }
      return jsonResponse({
        user_code: retryUserCode,
        device_code: retryDeviceCode,
        verification_url: `https://valis.krukit.co/auth/device?code=${retryUserCode}`,
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
    console.error('device-code: unexpected error', (err as Error).message);
    return jsonResponse({ error: 'creation_failed' }, 500);
  }
}
