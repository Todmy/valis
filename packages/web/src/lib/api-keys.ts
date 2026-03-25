/**
 * T006: Shared key generators.
 *
 * Generates org API keys (tm_), member keys (tmm_), and invite codes (XXXX-XXXX).
 */

/**
 * Generate an org-level API key: tm_ + 32 hex chars.
 */
export function generateOrgApiKey(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `tm_${hex}`;
}

/**
 * Generate a per-member API key: tmm_ + 32 hex chars.
 */
export function generateMemberKey(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `tmm_${hex}`;
}

/**
 * Generate an invite code in XXXX-XXXX format.
 * Uses charset without ambiguous characters (no 0, O, 1, I).
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = (len: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(len)))
      .map((b) => chars[b % chars.length])
      .join('');
  return `${part(4)}-${part(4)}`;
}
