/*
 * TalNXT website forms API (Cloudflare Worker).
 *
 *   POST /api/enquiry    multipart/form-data  client enquiry (staffing or HR)
 *   POST /api/candidate  multipart/form-data  job application with resume (PDF or DOCX, max 5 MB)
 *   GET  /api/health                          liveness check, returns {"ok":true}
 *
 * Request pipeline: route -> CORS/origin -> content type and size -> rate limit -> parse
 * -> honeypot -> validate -> Turnstile -> store in SharePoint and email via Microsoft Graph.
 * Responses: {"ok":true,"id":"..."} or {"ok":false,"error":{"code","message","fields?"}}.
 */
import { corsHeaders, isAllowedOrigin, parseOrigins } from './cors';
import type { Env } from './env';
import { GraphError } from './graph';
import { candidate, enquiry, type Handler } from './handlers';
import { ApiError, GENERIC_ERROR, json, logEvent } from './http';
import { isHoneypotTripped } from './validate';
import { verifyTurnstile } from './turnstile';

interface Route {
  name: string;
  handler: Handler;
  /** Upper bound on the request body, checked against Content-Length before parsing. */
  maxBytes: number;
}

const ROUTES: Record<string, Route> = {
  '/api/enquiry': { name: 'enquiry', handler: enquiry, maxBytes: 64 * 1024 },
  '/api/candidate': { name: 'candidate', handler: candidate, maxBytes: 6 * 1024 * 1024 },
};

/** Random 10-character id (base32), used as the public reference and in file names. */
export function newSubmissionId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function handle(request: Request, env: Env, ctx: ExecutionContext, cors: Record<string, string>, originOk: boolean): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true }, 200);

  const route = ROUTES[url.pathname];
  if (!route) throw new ApiError(404, 'not_found', 'Not found.');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: originOk ? 204 : 403, headers: cors });
  }
  if (request.method !== 'POST') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
  if (!originOk) throw new ApiError(403, 'forbidden_origin', 'This form can only be submitted from the TalNXT website.');

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new ApiError(415, 'unsupported_media_type', 'Please submit the form from the website.');
  }
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > route.maxBytes) {
    throw new ApiError(413, 'too_large', route.name === 'candidate' ? 'Your resume must be 5 MB or smaller.' : 'Your message is too long.');
  }

  const ip = request.headers.get('CF-Connecting-IP');
  const { success } = await env.SUBMIT_LIMITER.limit({ key: `${route.name}:${ip ?? 'unknown'}` });
  if (!success) {
    throw new ApiError(429, 'rate_limited', 'You have sent several submissions in a short time. Please wait a minute and try again.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, 'bad_request', 'We could not read the form. Please try again.');
  }

  const submissionId = newSubmissionId();

  // Bots that fill the hidden field get a normal-looking success and nothing is stored.
  if (isHoneypotTripped(form)) {
    logEvent('warn', 'honeypot_tripped', { route: route.name });
    return json({ ok: true, id: submissionId }, 200, cors);
  }

  const input = await route.handler.validate(form);
  await verifyTurnstile(env.TURNSTILE_SECRET, form.get('cf-turnstile-response'), ip);

  const siteUrl = [...parseOrigins(env.ALLOWED_ORIGINS)].find((o) => o.startsWith('https://')) ?? 'https://www.talnxt.com';
  await route.handler.process(input, { env, ctx, submissionId, siteUrl });

  logEvent('info', 'submission_received', { route: route.name, id: submissionId });
  return json({ ok: true, id: submissionId }, 200, cors);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const origin = request.headers.get('Origin');
    const originOk = isAllowedOrigin(origin, parseOrigins(env.ALLOWED_ORIGINS));
    const cors = originOk ? corsHeaders(origin) : {};

    try {
      return await handle(request, env, ctx, cors, originOk);
    } catch (err) {
      if (err instanceof ApiError) {
        const error: Record<string, unknown> = { code: err.code, message: err.publicMessage };
        if (err.fields) error.fields = err.fields;
        return json({ ok: false, error }, err.status, cors);
      }
      if (err instanceof GraphError) {
        logEvent('error', 'graph_failed', { stage: err.stage, status: err.status, code: err.graphCode });
      } else {
        logEvent('error', 'unhandled', { name: err instanceof Error ? err.name : typeof err });
      }
      return json({ ok: false, error: { code: 'server_error', message: GENERIC_ERROR } }, 502, cors);
    }
  },
} satisfies ExportedHandler<Env>;
