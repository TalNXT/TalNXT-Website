import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { resetTokenCache } from '../src/graph';
import { BENCH_TTL_MS, KV_BENCH, resetBenchCache, toProfile, type BenchSnapshot } from '../src/bench';
import { ENQUIRY_STAFFING_RULES, validateFields } from '../src/validate';
import { testCtx, testEnv } from './helpers';

const REFRESH = 'refresh-key-0123456789abcdef';
const ORIGIN = 'https://www.talnxt.com';

function fakeKV() {
  const store = new Map<string, string>();
  return {
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
}

const item = (f: Record<string, unknown>) => ({
  id: String(Math.random()),
  lastModifiedDateTime: '2026-11-20T10:00:00Z',
  fields: {
    Title: 'TNB-1001',
    Role: 'Senior React Developer',
    Vertical: 'Engineering',
    PrimaryTech: 'ReactJS',
    SkillSet: 'React, Redux, TypeScript, react',
    ExperienceYears: 6.5,
    Availability: 'Immediate',
    Location: 'Bengaluru',
    WorkMode: ['Hybrid', 'Remote'],
    Summary: 'Built fintech dashboards.',
    CostINR: 180000,
    CostUSD: 2200,
    Published: true,
    InternalNotes: 'Candidate name: Rahul — do not share',
    ...f,
  },
});

let pages: unknown[][];
let graphCalls: string[];
let graphStatus: number;

async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.startsWith('https://login.microsoftonline.com/')) return Response.json({ access_token: 't', expires_in: 3599 });
  graphCalls.push(url);
  if (graphStatus !== 200) return Response.json({ error: { code: 'accessDenied' } }, { status: graphStatus });
  const page = Number(new URL(url).searchParams.get('page') ?? 0);
  const next = page + 1 < pages.length ? `https://graph.microsoft.com/v1.0/sites/site/lists/bench/items?page=${page + 1}` : undefined;
  return Response.json({ value: pages[page] ?? [], ...(next ? { '@odata.nextLink': next } : {}) });
}

beforeEach(() => {
  pages = [[item({})]];
  graphCalls = [];
  graphStatus = 200;
  resetTokenCache();
  resetBenchCache();
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const benchEnv = (kv = fakeKV(), overrides = {}) =>
  testEnv({ BENCH_LIST_ID: 'bench', BENCH_REFRESH_KEY: REFRESH, LINKEDIN_KV: kv as unknown as KVNamespace, ...overrides });

async function get(path: string, env = benchEnv(), method = 'GET') {
  const ctx = testCtx();
  const res = await worker.fetch(new Request(`https://x.workers.dev${path}`, { method, headers: { Origin: ORIGIN } }) as never, env, ctx);
  await Promise.all(ctx.pending);
  const text = await res.text();
  return { res, text, body: text ? JSON.parse(text) : null };
}

describe('toProfile', () => {
  it('maps whitelisted fields only and normalises values', () => {
    const p = toProfile({ ...item({}).fields, _modified: '2026-11-20T10:00:00Z' })!;
    expect(p).toEqual({
      id: 'TNB-1001',
      role: 'Senior React Developer',
      vertical: 'Engineering',
      tech: 'ReactJS',
      skills: ['React', 'Redux', 'TypeScript'],
      experience: 6.5,
      availability: 'Immediate',
      availableFrom: null,
      location: 'Bengaluru',
      workMode: ['Hybrid', 'Remote'],
      summary: 'Built fintech dashboards.',
      costInr: 180000,
      costUsd: 2200,
      updated: '2026-11-20',
    });
    expect(JSON.stringify(p)).not.toContain('Rahul');
  });

  it('drops unpublished items and items without an ID or role', () => {
    expect(toProfile({ ...item({ Published: false }).fields })).toBeNull();
    expect(toProfile({ ...item({ Published: undefined }).fields })).toBeNull();
    expect(toProfile({ ...item({ Title: '' }).fields })).toBeNull();
    expect(toProfile({ ...item({ Role: '  ' }).fields })).toBeNull();
  });

  it('treats blank or negative costs as on request', () => {
    const p = toProfile({ ...item({ CostINR: null, CostUSD: -5 }).fields })!;
    expect(p.costInr).toBeNull();
    expect(p.costUsd).toBeNull();
  });
});

describe('GET /api/bench', () => {
  it('returns published profiles, never internal columns, and asks Graph only for whitelisted fields', async () => {
    pages = [[item({}), item({ Title: 'TNB-1002', Published: false })], [item({ Title: 'TNB-2001', PrimaryTech: 'Angular' })]];
    const { res, body, text } = await get('/api/bench');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(body.source).toBe('live');
    expect(body.profiles.map((p: { id: string }) => p.id)).toEqual(['TNB-2001', 'TNB-1001']);
    expect(text).not.toContain('InternalNotes');
    expect(text).not.toContain('Rahul');
    expect(graphCalls).toHaveLength(2);
    expect(decodeURIComponent(graphCalls[0]!)).toContain('$expand=fields($select=Title,Role,');
    expect(decodeURIComponent(graphCalls[0]!)).not.toContain('InternalNotes');
  });

  it('serves from memory, then KV, within the TTL', async () => {
    const kv = fakeKV();
    await get('/api/bench', benchEnv(kv));
    const second = await get('/api/bench', benchEnv(kv));
    expect(second.body.source).toBe('memory');
    resetBenchCache();
    const third = await get('/api/bench', benchEnv(kv));
    expect(third.body.source).toBe('kv');
    expect(graphCalls).toHaveLength(1);
  });

  it('re-reads SharePoint after the TTL', async () => {
    const kv = fakeKV();
    await get('/api/bench', benchEnv(kv));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + BENCH_TTL_MS + 1000);
    const { body } = await get('/api/bench', benchEnv(kv));
    expect(body.source).toBe('live');
    expect(graphCalls).toHaveLength(2);
  });

  it('forces a re-read with the refresh key only', async () => {
    const kv = fakeKV();
    await get('/api/bench', benchEnv(kv));
    await get('/api/bench?refresh=wrong', benchEnv(kv));
    expect(graphCalls).toHaveLength(1);
    const { res, body } = await get(`/api/bench?refresh=${REFRESH}`, benchEnv(kv));
    expect(body.source).toBe('live');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(graphCalls).toHaveLength(2);
  });

  it('serves the last good snapshot when Graph fails', async () => {
    const kv = fakeKV();
    const old: BenchSnapshot = { updatedAt: '2026-01-01T00:00:00Z', profiles: [toProfile(item({ Title: 'TNB-OLD' }).fields)!] };
    kv.store.set(KV_BENCH, JSON.stringify(old));
    graphStatus = 403;
    const { res, body } = await get('/api/bench', benchEnv(kv));
    expect(res.status).toBe(200);
    expect(body.source).toBe('stale');
    expect(body.profiles[0].id).toBe('TNB-OLD');
  });

  it('returns 503 when Graph fails and there is no snapshot', async () => {
    graphStatus = 500;
    const { res, body } = await get('/api/bench');
    expect(res.status).toBe(503);
    expect(body.error.code).toBe('bench_unavailable');
  });

  it('returns 503 when the list is not configured', async () => {
    const { res, body } = await get('/api/bench', benchEnv(fakeKV(), { BENCH_LIST_ID: '' }));
    expect(res.status).toBe(503);
    expect(body.error.code).toBe('bench_not_configured');
    expect(graphCalls).toHaveLength(0);
  });

  it('answers CORS preflight with GET and rejects POST', async () => {
    const pre = await get('/api/bench', benchEnv(), 'OPTIONS');
    expect(pre.res.status).toBe(204);
    expect(pre.res.headers.get('Access-Control-Allow-Methods')).toBe('GET');
    const post = await get('/api/bench', benchEnv(), 'POST');
    expect(post.res.status).toBe(405);
  });
});

describe('enquiry profiles field', () => {
  const form = (profiles: string) => {
    const f = new FormData();
    f.set('roles', 'React developers');
    f.set('profiles', profiles);
    return f;
  };

  it('normalises, upper-cases and de-duplicates profile IDs', () => {
    const r = validateFields(form(' tnb-1001, TNB-1002 ,tnb-1001,'), ENQUIRY_STAFFING_RULES);
    expect(r.errors).toEqual({});
    expect(r.values.profiles).toBe('TNB-1001, TNB-1002');
  });

  it('is optional', () => {
    expect(validateFields(form(''), ENQUIRY_STAFFING_RULES).values.profiles).toBe('');
  });

  it('rejects anything that is not a list of IDs', () => {
    expect(validateFields(form('TNB-1 <script>'), ENQUIRY_STAFFING_RULES).errors.profiles).toBeDefined();
    expect(validateFields(form(Array.from({ length: 26 }, (_, i) => `P${i}`).join(',')), ENQUIRY_STAFFING_RULES).errors.profiles).toBeDefined();
  });
});
