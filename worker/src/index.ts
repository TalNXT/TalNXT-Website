/*
 * TalNXT website forms API (Cloudflare Worker).
 *
 *   POST /api/enquiry    multipart/form-data  client enquiry (staffing or HR)
 *   POST /api/candidate  multipart/form-data  job application with resume (PDF or DOCX, max 5 MB)
 *   POST /api/digital-enquiry  multipart/form-data  TalNXT Digital contact form (talnxtdigital.com)
 *   GET  /api/health                          liveness check, returns {"ok":true}
 *   GET  /api/bench[?refresh=key]             Talent Bench profiles from SharePoint (cached 10 min)
 *   GET  /api/linkedin-posts                  latest LinkedIn company posts, or 404 so the site uses its static posts
 *   GET  /api/linkedin/connect?key=...        admin: start the one-time LinkedIn sign-in
 *   GET  /api/linkedin/callback               LinkedIn redirects here after sign-in
 *   GET  /api/linkedin/sync?key=...           admin: run a sync now and show the result
 *   (cron)                                    re-syncs the LinkedIn feed on the schedule in wrangler.toml
 *
 * Request pipeline: route -> CORS/origin -> content type and size -> rate limit -> parse
 * -> honeypot -> validate -> Turnstile -> store in SharePoint and email via Microsoft Graph.
 * Responses: {"ok":true,"id":"..."} or {"ok":false,"error":{"code","message","fields?"}}.
 */
import { corsHeaders, isAllowedOrigin, parseOrigins } from './cors';
import type { Env } from './env';
import { handleBench } from './bench';
import { GraphError } from './graph';
import { candidate, digitalEnquiry, enquiry, type Handler } from './handlers';
import { ApiError, GENERIC_ERROR, json, logEvent } from './http';
import { isHoneypotTripped } from './validate';
import { verifyTurnstile } from './turnstile';
import { adminPage, consumeState, finishConnect, linkedinConfigured, liveFeed, setupKeyOk, startConnect, syncLinkedIn } from './linkedin';

async function handleLinkedIn(request: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const base = url.origin;

  if (url.pathname === '/api/linkedin-posts') {
    const feed = await liveFeed(env);
    const headers = { ...cors, 'Access-Control-Allow-Methods': 'GET', Vary: 'Origin' };
    if (!feed) return json({ ok: false, error: { code: 'no_live_feed', message: 'No live feed available.' } }, 404, { ...headers, 'Cache-Control': 'public, max-age=300' });
    return json({ ok: true, source: 'live', updatedAt: feed.updatedAt, posts: feed.posts }, 200, { ...headers, 'Cache-Control': 'public, max-age=300' });
  }

  if (url.pathname === '/api/linkedin/connect' || url.pathname === '/api/linkedin/sync') {
    if (!setupKeyOk(env, url.searchParams.get('key'))) return adminPage('Not allowed', 'This link needs a valid setup key.', false);
    if (!linkedinConfigured(env)) return adminPage('LinkedIn feed not configured', 'Set LINKEDIN_ORG_ID and LINKEDIN_CLIENT_ID in wrangler.toml and the LINKEDIN_CLIENT_SECRET secret, then deploy again.', false);
    if (url.pathname === '/api/linkedin/connect') return Response.redirect(await startConnect(env, request.url), 302);
    const result = await syncLinkedIn(env, base);
    return adminPage(result.status === 'ok' ? 'Sync complete' : 'Sync did not complete', `Result: ${JSON.stringify(result)}`, result.status === 'ok');
  }

  if (url.pathname === '/api/linkedin/callback') {
    if (!linkedinConfigured(env)) return adminPage('LinkedIn feed not configured', 'Finish the configuration first.', false);
    const error = url.searchParams.get('error');
    if (error) return adminPage('LinkedIn sign-in was cancelled', `LinkedIn returned: ${error.slice(0, 80)}. Nothing was changed.`, false);
    if (!(await consumeState(env.LINKEDIN_KV, url.searchParams.get('state')))) {
      return adminPage('Link expired', 'This sign-in link has expired or was already used. Open the connect link again.', false);
    }
    const code = url.searchParams.get('code');
    if (!code) return adminPage('Sign-in failed', 'LinkedIn did not return an authorisation code. Please try again.', false);
    try {
      await finishConnect(env, code, request.url);
    } catch (err) {
      logEvent('error', 'linkedin_connect_failed', { reason: err instanceof Error ? err.message : 'unknown' });
      return adminPage('Sign-in failed', 'LinkedIn did not accept the sign-in. Check the app settings (redirect URL, client secret) and try again.', false);
    }
    const result = await syncLinkedIn(env, base);
    return result.status === 'ok'
      ? adminPage('LinkedIn connected', `The website now shows ${result.count} live posts from the TalNXT page. You can close this tab.`, true)
      : adminPage('Connected, but the first sync did not complete', `Result: ${JSON.stringify(result)}. The site keeps showing its saved posts until a sync succeeds. Check the Worker logs.`, false);
  }
  return null;
}

interface Route {
  name: string;
  handler: Handler;
  /** Upper bound on the request body, checked against Content-Length before parsing. */
  maxBytes: number;
}

const ROUTES: Record<string, Route> = {
  '/api/enquiry': { name: 'enquiry', handler: enquiry, maxBytes: 64 * 1024 },
  '/api/candidate': { name: 'candidate', handler: candidate, maxBytes: 6 * 1024 * 1024 },
  '/api/digital-enquiry': { name: 'digital_enquiry', handler: digitalEnquiry, maxBytes: 64 * 1024 },
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

  if (url.pathname === '/api/bench') {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: originOk ? 204 : 403, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
    return handleBench(request, env, ctx, cors);
  }

  if (url.pathname === '/api/linkedin-posts' && request.method === 'OPTIONS') {
    return new Response(null, { status: originOk ? 204 : 403, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
  }
  if (url.pathname.startsWith('/api/linkedin')) {
    const res = await handleLinkedIn(request, env, url, cors);
    if (res) return res;
    throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
  }

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

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(syncLinkedIn(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
