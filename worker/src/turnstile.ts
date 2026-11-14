import { ApiError, logEvent } from './http';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResult {
  success: boolean;
  'error-codes'?: string[];
}

/** Verifies a Turnstile token server-side. Throws ApiError(403) when the check fails. */
export async function verifyTurnstile(secret: string, token: unknown, ip: string | null): Promise<void> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    throw new ApiError(403, 'verification_failed', 'Please complete the security check and try again.');
  }

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);

  let result: SiteverifyResult;
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`siteverify HTTP ${res.status}`);
    result = (await res.json()) as SiteverifyResult;
  } catch (err) {
    logEvent('error', 'turnstile_unreachable', { reason: err instanceof Error ? err.message : 'unknown' });
    throw new ApiError(503, 'verification_unavailable', 'We could not run the security check just now. Please try again in a minute.');
  }

  if (!result.success) {
    // Error codes are Cloudflare's own (e.g. "timeout-or-duplicate"), never visitor data.
    logEvent('warn', 'turnstile_rejected', { codes: (result['error-codes'] ?? []).join(',') });
    throw new ApiError(403, 'verification_failed', 'The security check expired or failed. Please try submitting again.');
  }
}
