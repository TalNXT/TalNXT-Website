import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { resetTokenCache } from '../src/graph';
import { plainCommentary, syncLinkedIn, toFeedPost, topicFromHashtag, type StoredToken } from '../src/linkedin';
import { testCtx, testEnv } from './helpers';

const SETUP_KEY = 'setup-key-0123456789abcdef';
const BASE = 'https://talnxt-forms.talnxt.workers.dev';
const ORIGIN = 'https://www.talnxt.com';

/** In-memory stand-in for a KV namespace. */
function fakeKV() {
  const store = new Map<string, string>();
  const kv = {
    store,
    async get(key: string, type?: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  return kv;
}

function liEnv(kv = fakeKV(), overrides = {}) {
  return testEnv({
    DRY_RUN: 'false',
    LINKEDIN_KV: kv as unknown as KVNamespace,
    LINKEDIN_CLIENT_ID: 'li-client',
    LINKEDIN_CLIENT_SECRET: 'li-secret',
    LINKEDIN_ORG_ID: '123456',
    LINKEDIN_API_VERSION: '202610',
    LINKEDIN_SETUP_KEY: SETUP_KEY,
    ...overrides,
  });
}

const DAY = 86_400_000;
const apiPost = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `urn:li:share:70000000000000000${n}`,
  commentary: `Opening line number ${n}.\n\nSecond paragraph ${n}.\n\nThird paragraph.\n\n🌐 https://www.talnxt.com/\n\n{hashtag|\\#|BusinessStrategy} {hashtag|\\#|Leadership}`,
  publishedAt: Date.UTC(2026, 10, n),
  lifecycleState: 'PUBLISHED',
  visibility: 'PUBLIC',
  ...extra,
});

interface Call {
  url: string;
  method: string;
  body: string;
  headers: Headers;
}
let calls: Call[];
let logs: string[];
let postsResponse: () => Response;
let tokenResponse: () => Response;

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  calls.push({ url, method: init.method ?? 'GET', body: String(init.body ?? ''), headers: new Headers(init.headers) });
  if (url === 'https://www.linkedin.com/oauth/v2/accessToken') return tokenResponse();
  if (url.startsWith('https://api.linkedin.com/rest/posts')) return postsResponse();
  if (url.startsWith('https://login.microsoftonline.com/')) return Response.json({ access_token: 'graph-token', expires_in: 3599 });
  if (url.endsWith('/sendMail')) return new Response(null, { status: 202 });
  return new Response('unexpected', { status: 500 });
}

beforeEach(() => {
  calls = [];
  logs = [];
  resetTokenCache();
  postsResponse = () => Response.json({ elements: [apiPost(3), apiPost(5), apiPost(4)] });
  tokenResponse = () => Response.json({ access_token: 'li-access-token', expires_in: 60 * 24 * 3600 });
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function get(path: string, env = liEnv(), headers: Record<string, string> = {}) {
  const ctx = testCtx();
  const res = await worker.fetch(new Request(BASE + path, { headers }) as never, env, ctx);
  await Promise.all(ctx.pending);
  return res;
}

describe('LinkedIn text conversion', () => {
  it('turns little-text hashtags, mentions and escapes into plain text', () => {
    expect(plainCommentary('Hi @[TalNXT Technologies](urn:li:organization:1) \\(really\\) {hashtag|\\#|AI} 6\\-12')).toBe(
      'Hi TalNXT Technologies (really) #AI 6\\-12',
    );
  });

  it('builds a card: title, excerpt, body; drops hashtag lines, links and sign-offs', () => {
    const post = toFeedPost(apiPost(5));
    expect(post).toEqual({
      topic: 'Business Strategy',
      date: '2026-11-05',
      title: 'Opening line number 5.',
      excerpt: 'Second paragraph 5.',
      body: ['Third paragraph.'],
      url: 'https://www.linkedin.com/feed/update/urn:li:share:700000000000000005',
    });
  });

  it('keeps bullet lines inside a paragraph', () => {
    const post = toFeedPost(apiPost(1, { commentary: 'Title.\n\nIntro.\n\n• one\n• two' }));
    expect(post?.body).toEqual(['• one\n• two']);
    expect(post?.topic).toBe('Insights');
  });

  it('splits a long opening paragraph into a title sentence and excerpt', () => {
    const long = 'Short first sentence here. ' + 'More words follow in the same paragraph. '.repeat(6);
    const post = toFeedPost(apiPost(1, { commentary: long + '\n\nNext.' }));
    expect(post?.title).toBe('Short first sentence here.');
    expect(post?.excerpt.startsWith('More words follow')).toBe(true);
    expect(post?.body).toEqual(['Next.']);
  });

  it('skips drafts, non-public posts, bad ids and posts with no text of our own', () => {
    expect(toFeedPost(apiPost(1, { lifecycleState: 'DRAFT' }))).toBeNull();
    expect(toFeedPost(apiPost(1, { visibility: 'CONNECTIONS' }))).toBeNull();
    expect(toFeedPost(apiPost(1, { id: 'urn:li:share:abc' }))).toBeNull();
    expect(toFeedPost(apiPost(1, { commentary: '{hashtag|\\#|Leadership}\n\nhttps://example.com' }))).toBeNull();
  });

  it('turns hashtags into readable topics', () => {
    expect(topicFromHashtag('BusinessStrategy')).toBe('Business Strategy');
    expect(topicFromHashtag('AIAdoption')).toBe('AI Adoption');
    expect(topicFromHashtag('Leadership')).toBe('Leadership');
  });
});

describe('GET /api/linkedin-posts', () => {
  it('returns 404 (site uses its static posts) when the feature is not set up', async () => {
    const res = await get('/api/linkedin-posts', testEnv(), { Origin: ORIGIN });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('no_live_feed');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('returns 404 when the stored feed is older than 7 days', async () => {
    const kv = fakeKV();
    kv.store.set('li:feed', JSON.stringify({ updatedAt: new Date(Date.now() - 8 * DAY).toISOString(), posts: [toFeedPost(apiPost(1))] }));
    expect((await get('/api/linkedin-posts', liEnv(kv), { Origin: ORIGIN })).status).toBe(404);
  });

  it('serves a recent feed with CORS and a short public cache', async () => {
    const kv = fakeKV();
    kv.store.set('li:feed', JSON.stringify({ updatedAt: new Date().toISOString(), posts: [toFeedPost(apiPost(1))] }));
    const res = await get('/api/linkedin-posts', liEnv(kv), { Origin: ORIGIN });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; source: string; posts: unknown[] };
    expect(body).toMatchObject({ ok: true, source: 'live' });
    expect(body.posts).toHaveLength(1);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it('gives other websites no CORS access', async () => {
    const res = await get('/api/linkedin-posts', liEnv(), { Origin: 'https://evil.example' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('admin links', () => {
  it('reject a missing or wrong setup key', async () => {
    expect((await get('/api/linkedin/connect')).status).toBe(400);
    expect((await get('/api/linkedin/connect?key=wrong-key-0123456789')).status).toBe(400);
    expect((await get('/api/linkedin/sync?key=nope')).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('say so when LinkedIn is not configured yet', async () => {
    const res = await get(`/api/linkedin/connect?key=${SETUP_KEY}`, liEnv(fakeKV(), { LINKEDIN_ORG_ID: '' }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('not configured');
  });

  it('connect redirects to LinkedIn with a one-time state and only the read scope', async () => {
    const kv = fakeKV();
    const res = await get(`/api/linkedin/connect?key=${SETUP_KEY}`, liEnv(kv));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location')!);
    expect(loc.origin + loc.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(loc.searchParams.get('scope')).toBe('r_organization_social');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${BASE}/api/linkedin/callback`);
    expect(kv.store.has(`li:state:${loc.searchParams.get('state')}`)).toBe(true);
  });
});

describe('sign-in callback and sync', () => {
  async function connect(kv = fakeKV()) {
    const res = await get(`/api/linkedin/connect?key=${SETUP_KEY}`, liEnv(kv));
    return { kv, state: new URL(res.headers.get('Location')!).searchParams.get('state')! };
  }

  it('rejects an unknown or reused state', async () => {
    const { kv, state } = await connect();
    expect((await get('/api/linkedin/callback?code=c&state=' + 'a'.repeat(48), liEnv(kv))).status).toBe(400);
    expect((await get(`/api/linkedin/callback?code=c&state=${state}`, liEnv(kv))).status).toBe(200);
    expect((await get(`/api/linkedin/callback?code=c&state=${state}`, liEnv(kv))).status).toBe(400);
  });

  it('stores the token, syncs posts newest first, and never logs the token', async () => {
    const { kv, state } = await connect();
    const res = await get(`/api/linkedin/callback?code=auth-code&state=${state}`, liEnv(kv));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('3 live posts');

    const exchange = calls.find((c) => c.url.endsWith('/accessToken'))!;
    const params = new URLSearchParams(exchange.body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('redirect_uri')).toBe(`${BASE}/api/linkedin/callback`);

    const api = calls.find((c) => c.url.startsWith('https://api.linkedin.com/rest/posts'))!;
    expect(api.url).toContain('author=urn%3Ali%3Aorganization%3A123456');
    expect(api.headers.get('Authorization')).toBe('Bearer li-access-token');
    expect(api.headers.get('LinkedIn-Version')).toBe('202610');

    const feed = JSON.parse(kv.store.get('li:feed')!);
    expect(feed.posts.map((p: { date: string }) => p.date)).toEqual(['2026-11-05', '2026-11-04', '2026-11-03']);
    expect(logs.join('\n')).not.toMatch(/li-access-token|li-secret|auth-code/);

    const live = await get('/api/linkedin-posts', liEnv(kv), { Origin: ORIGIN });
    expect(live.status).toBe(200);
  });

  it('keeps the last good feed when LinkedIn returns an error', async () => {
    const kv = fakeKV();
    const good = { updatedAt: new Date().toISOString(), posts: [toFeedPost(apiPost(9))] };
    kv.store.set('li:feed', JSON.stringify(good));
    kv.store.set('li:token', JSON.stringify({ accessToken: 'li-access-token', expiresAt: Date.now() + 50 * DAY } satisfies StoredToken));
    postsResponse = () => Response.json({ code: 'NONEXISTENT_VERSION' }, { status: 426 });
    const result = await syncLinkedIn(liEnv(kv));
    expect(result).toEqual({ status: 'api_error', httpStatus: 426, code: 'NONEXISTENT_VERSION' });
    expect(JSON.parse(kv.store.get('li:feed')!)).toEqual(good);
  });

  it('refreshes an expiring token when LinkedIn issued a refresh token', async () => {
    const kv = fakeKV();
    kv.store.set('li:token', JSON.stringify({ accessToken: 'old', expiresAt: Date.now() + 3600_000, refreshToken: 'r1', refreshExpiresAt: Date.now() + 300 * DAY }));
    const result = await syncLinkedIn(liEnv(kv));
    expect(result.status).toBe('ok');
    expect(new URLSearchParams(calls.find((c) => c.url.endsWith('/accessToken'))!.body).get('grant_type')).toBe('refresh_token');
    expect(JSON.parse(kv.store.get('li:token')!).accessToken).toBe('li-access-token');
    expect(calls.some((c) => c.url.endsWith('/sendMail'))).toBe(false);
  });

  it('emails one reconnect reminder when the token is about to expire, then waits', async () => {
    const kv = fakeKV();
    kv.store.set('li:token', JSON.stringify({ accessToken: 'li-access-token', expiresAt: Date.now() + 5 * DAY }));
    expect((await syncLinkedIn(liEnv(kv))).status).toBe('ok');
    const mails = calls.filter((c) => c.url.endsWith('/sendMail'));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.url).toContain(encodeURIComponent('careers@talnxt.test'));
    expect(mails[0]!.body).toContain('YOUR-SETUP-KEY');
    expect(mails[0]!.body).not.toContain(SETUP_KEY);

    await syncLinkedIn(liEnv(kv));
    expect(calls.filter((c) => c.url.endsWith('/sendMail'))).toHaveLength(1);
  });

  it('does nothing before anyone has connected', async () => {
    expect(await syncLinkedIn(liEnv())).toEqual({ status: 'not_connected' });
    expect(await syncLinkedIn(testEnv())).toEqual({ status: 'not_configured' });
    expect(calls).toHaveLength(0);
  });
});
