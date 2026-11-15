import type { Env } from './env';
import { recipients, sendMail } from './graph';
import { escapeHtml } from './emails';
import { logEvent } from './http';

/*
 * LinkedIn company-page feed for the Thought Leadership page.
 *
 * Uses only LinkedIn's official API (Community Management API, scope r_organization_social):
 *   1. A page admin opens /api/linkedin/connect?key=<LINKEDIN_SETUP_KEY> once and approves access.
 *   2. /api/linkedin/callback stores the token in KV and runs the first sync.
 *   3. A cron trigger (wrangler.toml) re-syncs every few hours; the last good feed stays in KV.
 *   4. GET /api/linkedin-posts serves that feed. When there is no recent feed it returns 404 and
 *      the website falls back to its static data/linkedin-posts.json.
 * Tokens are never logged or returned. Only public posts by our own organisation are stored.
 */

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const API = 'https://api.linkedin.com/rest';
export const LINKEDIN_SCOPE = 'r_organization_social';

const KEY_TOKEN = 'li:token';
const KEY_FEED = 'li:feed';
const KEY_REMINDED = 'li:reminded';
const STATE_PREFIX = 'li:state:';

/** The live feed is served only if a sync succeeded within this window; otherwise the site uses static posts. */
export const FEED_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** Start emailing a reconnect reminder this many days before the token expires. */
const REMIND_BEFORE_DAYS = 10;
const REMIND_EVERY_SECONDS = 3 * 24 * 3600;
const MAX_POSTS = 24;

export interface StoredToken {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
}

export interface FeedPost {
  topic: string;
  date: string;
  title: string;
  excerpt: string;
  body: string[];
  url: string;
}

export interface Feed {
  updatedAt: string;
  posts: FeedPost[];
}

export type SyncResult =
  | { status: 'ok'; count: number; changed: boolean }
  | { status: 'not_configured' | 'not_connected' | 'token_expired' | 'no_posts' }
  | { status: 'api_error'; httpStatus: number; code?: string };

export function linkedinConfigured(env: Env): env is Env & Required<Pick<Env, 'LINKEDIN_KV' | 'LINKEDIN_CLIENT_ID' | 'LINKEDIN_CLIENT_SECRET' | 'LINKEDIN_ORG_ID'>> {
  return Boolean(env.LINKEDIN_KV && env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET && /^\d+$/.test(env.LINKEDIN_ORG_ID ?? ''));
}

// ---------------------------------------------------------------- text conversion

/**
 * Converts LinkedIn's "little text" commentary to plain text:
 * hashtags {hashtag|\#|Leadership} -> #Leadership, mentions @[Name](urn:...) -> Name, \X escapes -> X.
 */
export function plainCommentary(text: string): string {
  return text
    .replace(/\{hashtag\|\\?#\|([^}]+)\}/g, '#$1')
    .replace(/@\[([^\]]+)\]\(urn:li:[^)]+\)/g, '$1')
    .replace(/\\([\\(){}[\]<>@|~_*#])/g, '$1')
    .replace(/\r\n?/g, '\n');
}

/** Lines that are only hashtags, bare links or the usual "visit our website / follow us" sign-offs. */
function isBoilerplate(line: string): boolean {
  return (
    /^(#[\p{L}\p{N}_]+[\s,.]*)+$/u.test(line) ||
    /^https?:\/\/\S+$/.test(line) ||
    /^(🌐|🔔)/u.test(line) ||
    /^(to know more about talnxt|visit our (website|page)|follow (our page|us))/i.test(line)
  );
}

/** "BusinessStrategy" -> "Business Strategy", "AI" stays "AI". */
export function topicFromHashtag(tag: string): string {
  const words = tag.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/_/g, ' ').trim();
  return words.length > 24 ? words.slice(0, 24).trim() : words;
}

function istDate(ms: number): string {
  return new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

interface ApiPost {
  id?: string;
  commentary?: string;
  publishedAt?: number;
  createdAt?: number;
  lifecycleState?: string;
  visibility?: string;
  reshareContext?: unknown;
}

/** Maps one API post to a card, or null if it should not be shown. */
export function toFeedPost(p: ApiPost): FeedPost | null {
  if (!p.id || !/^urn:li:(share|ugcPost|activity):\d+$/.test(p.id)) return null;
  if (p.lifecycleState && p.lifecycleState !== 'PUBLISHED') return null;
  if (p.visibility && p.visibility !== 'PUBLIC') return null;
  const published = p.publishedAt ?? p.createdAt;
  if (!published || typeof p.commentary !== 'string') return null;

  const text = plainCommentary(p.commentary);
  const firstTag = /#([\p{L}\p{N}_]+)/u.exec(text);
  const paras = text
    .split(/\n\s*\n/)
    .map((para) => para.split('\n').map((l) => l.trim()).filter((l) => l && !isBoilerplate(l)).join('\n'))
    .filter(Boolean);
  if (!paras.length) return null; // e.g. a reshare with no text of our own

  let title = paras[0]!;
  let excerpt = paras[1] ?? '';
  let body = paras.slice(2);
  // A long opening paragraph: use its first sentence as the title and the rest as the excerpt.
  if (title.length > 160) {
    const m = /^(.{20,160}?[.?!])\s+(.+)$/s.exec(title);
    if (m) {
      body = excerpt ? [excerpt, ...body] : body;
      excerpt = m[2]!;
      title = m[1]!;
    }
  }
  return {
    topic: firstTag ? topicFromHashtag(firstTag[1]!) : 'Insights',
    date: istDate(published),
    title: title.slice(0, 300),
    excerpt: excerpt.slice(0, 600),
    body: body.slice(0, 20).map((b) => b.slice(0, 1500)),
    url: `https://www.linkedin.com/feed/update/${p.id}`,
  };
}

// ---------------------------------------------------------------- OAuth

function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i]! ^ eb[i]!;
  return diff === 0;
}

export function setupKeyOk(env: Env, key: string | null): boolean {
  const expected = env.LINKEDIN_SETUP_KEY ?? '';
  return expected.length >= 16 && key !== null && constantTimeEqual(key, expected);
}

export function callbackUrl(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/api/linkedin/callback`;
}

/** Starts the admin sign-in: stores a one-time state and returns LinkedIn's consent URL. */
export async function startConnect(env: Env & { LINKEDIN_KV: KVNamespace; LINKEDIN_CLIENT_ID: string }, requestUrl: string): Promise<string> {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  await env.LINKEDIN_KV.put(STATE_PREFIX + state, '1', { expirationTtl: 600 });
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri: callbackUrl(requestUrl),
    state,
    scope: LINKEDIN_SCOPE,
  }).toString();
  return u.toString();
}

export async function consumeState(kv: KVNamespace, state: string | null): Promise<boolean> {
  if (!state || !/^[a-f0-9]{48}$/.test(state)) return false;
  const found = await kv.get(STATE_PREFIX + state);
  if (found === null) return false;
  await kv.delete(STATE_PREFIX + state);
  return true;
}

class LinkedInError extends Error {
  constructor(
    readonly stage: string,
    readonly httpStatus: number,
    readonly code?: string,
  ) {
    super(`${stage} failed (${httpStatus}${code ? ` ${code}` : ''})`);
  }
}

async function tokenRequest(env: Env & { LINKEDIN_CLIENT_ID: string; LINKEDIN_CLIENT_SECRET: string }, params: Record<string, string>, stage: string): Promise<StoredToken> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error?: string;
  };
  if (!res.ok || !data.access_token || !data.expires_in) throw new LinkedInError(stage, res.status, data.error);
  const now = Date.now();
  return {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
    ...(data.refresh_token && data.refresh_token_expires_in
      ? { refreshToken: data.refresh_token, refreshExpiresAt: now + data.refresh_token_expires_in * 1000 }
      : {}),
  };
}

/** Exchanges the sign-in code for a token and stores it. */
export async function finishConnect(env: Env, code: string, requestUrl: string): Promise<void> {
  if (!linkedinConfigured(env)) throw new LinkedInError('connect', 503, 'not_configured');
  const token = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: callbackUrl(requestUrl) }, 'token_exchange');
  await env.LINKEDIN_KV.put(KEY_TOKEN, JSON.stringify(token));
  await env.LINKEDIN_KV.delete(KEY_REMINDED);
  logEvent('info', 'linkedin_connected', { days: Math.round((token.expiresAt - Date.now()) / 86_400_000), refresh: Boolean(token.refreshToken) });
}

// ---------------------------------------------------------------- sync

async function validToken(env: Env & { LINKEDIN_KV: KVNamespace; LINKEDIN_CLIENT_ID: string; LINKEDIN_CLIENT_SECRET: string }): Promise<StoredToken | null> {
  const token = await env.LINKEDIN_KV.get<StoredToken>(KEY_TOKEN, 'json');
  if (!token) return null;
  const soon = Date.now() + 24 * 3600 * 1000;
  if (token.expiresAt > soon) return token;
  if (token.refreshToken && (token.refreshExpiresAt ?? 0) > Date.now()) {
    const fresh = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: token.refreshToken }, 'token_refresh');
    await env.LINKEDIN_KV.put(KEY_TOKEN, JSON.stringify(fresh));
    logEvent('info', 'linkedin_token_refreshed', {});
    return fresh;
  }
  return token.expiresAt > Date.now() ? token : null;
}

async function fetchPosts(env: Env & { LINKEDIN_ORG_ID: string }, token: string): Promise<FeedPost[]> {
  const author = encodeURIComponent(`urn:li:organization:${env.LINKEDIN_ORG_ID}`);
  const res = await fetch(`${API}/posts?q=author&author=${author}&count=40`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'LinkedIn-Version': env.LINKEDIN_API_VERSION || '202610',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { code?: string; serviceErrorCode?: number };
    throw new LinkedInError('posts', res.status, err.code ?? (err.serviceErrorCode ? String(err.serviceErrorCode) : undefined));
  }
  const data = (await res.json()) as { elements?: ApiPost[] };
  return (data.elements ?? [])
    .slice()
    .sort((a, b) => (b.publishedAt ?? b.createdAt ?? 0) - (a.publishedAt ?? a.createdAt ?? 0))
    .map(toFeedPost)
    .filter((p): p is FeedPost => p !== null)
    .slice(0, MAX_POSTS);
}

async function maybeRemind(env: Env & { LINKEDIN_KV: KVNamespace }, token: StoredToken | null, siteBase: string): Promise<void> {
  if (token?.refreshToken && (token.refreshExpiresAt ?? 0) > Date.now() + REMIND_BEFORE_DAYS * 86_400_000) return;
  const expiresAt = token?.expiresAt ?? 0;
  if (token && expiresAt > Date.now() + REMIND_BEFORE_DAYS * 86_400_000) return;
  if ((await env.LINKEDIN_KV.get(KEY_REMINDED)) !== null) return;
  if (!env.MAIL_FROM || !env.MAIL_TO) return;

  const expired = !token || expiresAt <= Date.now();
  const when = expired ? 'has expired' : `expires on ${istDate(expiresAt)}`;
  const connect = `${siteBase}/api/linkedin/connect?key=YOUR-SETUP-KEY`;
  try {
    await sendMail(
      env,
      {
        to: recipients(env.MAIL_TO),
        subject: expired ? 'Action needed: reconnect LinkedIn for the website feed' : 'Reminder: reconnect LinkedIn for the website feed',
        html: `<p>The LinkedIn connection that keeps the website's Thought Leadership page up to date ${escapeHtml(when)}.</p>
<p>Until it is reconnected, the page shows the saved posts from <code>data/linkedin-posts.json</code>, so nothing breaks, but new LinkedIn posts won't appear automatically.</p>
<p><strong>To reconnect (2 minutes):</strong> a super admin of the TalNXT LinkedIn page opens the link below, replacing YOUR-SETUP-KEY with the setup key kept in your password manager, and clicks Allow.</p>
<p><code>${escapeHtml(connect)}</code></p>
<p>See docs/SETUP.md, section "LinkedIn feed", for details.</p>`,
      },
      'linkedin_reminder',
    );
    await env.LINKEDIN_KV.put(KEY_REMINDED, '1', { expirationTtl: REMIND_EVERY_SECONDS });
    logEvent('info', 'linkedin_reminder_sent', { expired });
  } catch (err) {
    logEvent('warn', 'linkedin_reminder_failed', { reason: err instanceof Error ? err.message : 'unknown' });
  }
}

/** Fetches the latest posts and stores them. Keeps the previous feed whenever anything goes wrong. */
export async function syncLinkedIn(env: Env, siteBase = 'https://talnxt-forms.talnxt.workers.dev'): Promise<SyncResult> {
  if (!linkedinConfigured(env)) return { status: 'not_configured' };
  let token: StoredToken | null = null;
  let result: SyncResult;
  try {
    const stored = await env.LINKEDIN_KV.get<StoredToken>(KEY_TOKEN, 'json');
    if (!stored) {
      result = { status: 'not_connected' };
    } else {
      token = await validToken(env);
      if (!token) {
        result = { status: 'token_expired' };
      } else {
        const posts = await fetchPosts(env, token.accessToken);
        if (!posts.length) {
          result = { status: 'no_posts' };
        } else {
          const previous = await env.LINKEDIN_KV.get<Feed>(KEY_FEED, 'json');
          const changed = JSON.stringify(previous?.posts) !== JSON.stringify(posts);
          const ageOk = previous && Date.now() - Date.parse(previous.updatedAt) < 24 * 3600 * 1000;
          // Write when the posts changed, or once a day so updatedAt shows the sync is healthy.
          if (changed || !ageOk) await env.LINKEDIN_KV.put(KEY_FEED, JSON.stringify({ updatedAt: new Date().toISOString(), posts } satisfies Feed));
          result = { status: 'ok', count: posts.length, changed };
        }
      }
    }
  } catch (err) {
    result = err instanceof LinkedInError ? { status: 'api_error', httpStatus: err.httpStatus, code: err.code } : { status: 'api_error', httpStatus: 0, code: err instanceof Error ? err.name : 'unknown' };
  }
  logEvent(result.status === 'ok' ? 'info' : 'warn', 'linkedin_sync', { ...result });
  if (result.status !== 'not_connected') await maybeRemind(env, token ?? (await env.LINKEDIN_KV.get<StoredToken>(KEY_TOKEN, 'json')), siteBase);
  return result;
}

/** The stored feed if it is recent enough to show, otherwise null (the site then uses its static posts). */
export async function liveFeed(env: Env): Promise<Feed | null> {
  if (!env.LINKEDIN_KV) return null;
  const feed = await env.LINKEDIN_KV.get<Feed>(KEY_FEED, 'json');
  if (!feed || !Array.isArray(feed.posts) || !feed.posts.length) return null;
  if (Date.now() - Date.parse(feed.updatedAt) > FEED_MAX_AGE_MS) return null;
  return feed;
}

export function adminPage(title: string, message: string, ok: boolean): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 20px;color:#14203a}h1{font-size:22px;color:${ok ? '#1b7a5a' : '#b42318'}}code{background:#f1f4f9;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
  });
}
