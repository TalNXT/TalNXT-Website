/*
 * Talent Bench: anonymised bench profiles from the SharePoint "Bench Profiles" list,
 * served to talent-bench.html as JSON (GET /api/bench).
 *
 * Only items with "Show on website" (Published) = Yes are returned, and only the columns in
 * BENCH_FIELDS are ever read from Graph, so internal columns (InternalNotes etc.) cannot leak.
 *
 * Caching: SharePoint is read at most once per BENCH_TTL_MS. The result is kept in this
 * isolate's memory and in KV (key bench:snapshot), so every isolate shares it. If Graph
 * fails, the last good snapshot is served, whatever its age. ?refresh=<key> forces a re-read.
 */
import type { Env } from './env';
import { listItems } from './graph';
import { json, logEvent } from './http';

export const BENCH_TTL_MS = 10 * 60 * 1000;
export const KV_BENCH = 'bench:snapshot';

/** SharePoint internal column names. Nothing else is requested from Graph. */
export const BENCH_FIELDS = [
  'Title',
  'Role',
  'Vertical',
  'PrimaryTech',
  'SkillSet',
  'ExperienceYears',
  'Availability',
  'AvailableFrom',
  'Location',
  'WorkMode',
  'Summary',
  'CostINR',
  'CostUSD',
  'Published',
] as const;

export interface BenchProfile {
  id: string;
  role: string;
  vertical: string;
  tech: string;
  skills: string[];
  experience: number | null;
  availability: string;
  availableFrom: string | null;
  location: string;
  workMode: string[];
  summary: string;
  costInr: number | null;
  costUsd: number | null;
  updated: string | null;
}

export interface BenchSnapshot {
  updatedAt: string;
  profiles: BenchProfile[];
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const list = (v: unknown, max: number, maxItems: number): string[] => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\n]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const s = str(item, max);
    const k = s.toLowerCase();
    if (s && !seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
    if (out.length >= maxItems) break;
  }
  return out;
};

const isoDate = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
};

const isPublished = (v: unknown): boolean => v === true || v === 'true' || v === 'Yes' || v === 1;

/** Maps one SharePoint item's fields to the public profile, or null if it must not be shown. */
export function toProfile(f: Record<string, unknown>): BenchProfile | null {
  if (!isPublished(f.Published)) return null;
  const id = str(f.Title, 30);
  const role = str(f.Role, 120);
  if (!id || !role) return null;
  const exp = num(f.ExperienceYears);
  return {
    id,
    role,
    vertical: str(f.Vertical, 60) || 'Other',
    tech: str(f.PrimaryTech, 60) || 'Other',
    skills: list(f.SkillSet, 40, 30),
    experience: exp === null ? null : Math.round(exp * 10) / 10,
    availability: str(f.Availability, 30) || 'Immediate',
    availableFrom: isoDate(f.AvailableFrom),
    location: str(f.Location, 80),
    workMode: list(f.WorkMode, 20, 3),
    summary: typeof f.Summary === 'string' ? f.Summary.trim().slice(0, 400) : '',
    costInr: num(f.CostINR),
    costUsd: num(f.CostUSD),
    updated: isoDate(f._modified),
  };
}

export async function fetchBench(env: Env & { BENCH_LIST_ID: string }): Promise<BenchSnapshot> {
  const items = await listItems(env, env.BENCH_LIST_ID, BENCH_FIELDS, 'bench_list');
  const profiles = items
    .map(toProfile)
    .filter((p): p is BenchProfile => p !== null)
    .sort((a, b) => a.tech.localeCompare(b.tech) || (b.experience ?? 0) - (a.experience ?? 0) || a.id.localeCompare(b.id));
  return { updatedAt: new Date().toISOString(), profiles };
}

let memory: BenchSnapshot | null = null;

/** Exposed for tests. */
export function resetBenchCache(): void {
  memory = null;
}

const fresh = (s: BenchSnapshot | null): s is BenchSnapshot => !!s && Date.now() - Date.parse(s.updatedAt) < BENCH_TTL_MS;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function refreshKeyOk(env: Env, key: string | null): boolean {
  const expected = env.BENCH_REFRESH_KEY || env.LINKEDIN_SETUP_KEY || '';
  return expected.length >= 16 && key !== null && constantTimeEqual(key, expected);
}

/** Returns the snapshot to serve and where it came from. Throws only when there is nothing at all to serve. */
export async function loadBench(env: Env, force: boolean, ctx?: ExecutionContext): Promise<{ snapshot: BenchSnapshot; source: 'memory' | 'kv' | 'live' | 'stale' }> {
  if (!force && fresh(memory)) return { snapshot: memory, source: 'memory' };

  let stored: BenchSnapshot | null = null;
  if (env.LINKEDIN_KV) {
    stored = await env.LINKEDIN_KV.get<BenchSnapshot>(KV_BENCH, 'json').catch(() => null);
    if (!force && fresh(stored)) {
      memory = stored;
      return { snapshot: stored, source: 'kv' };
    }
  }

  try {
    const snapshot = await fetchBench(env as Env & { BENCH_LIST_ID: string });
    memory = snapshot;
    if (env.LINKEDIN_KV) {
      const write = env.LINKEDIN_KV.put(KV_BENCH, JSON.stringify(snapshot)).catch((e: Error) => logEvent('warn', 'bench_kv_write_failed', { reason: e.message }));
      if (ctx) ctx.waitUntil(write);
      else await write;
    }
    return { snapshot, source: 'live' };
  } catch (err) {
    const fallback = stored ?? memory;
    logEvent('error', 'bench_fetch_failed', { reason: err instanceof Error ? err.message : 'unknown', fallback: !!fallback });
    if (fallback) return { snapshot: fallback, source: 'stale' };
    throw err;
  }
}

/** GET /api/bench */
export async function handleBench(request: Request, env: Env, ctx: ExecutionContext, cors: Record<string, string>): Promise<Response> {
  const headers = { ...cors, 'Access-Control-Allow-Methods': 'GET', Vary: 'Origin' };
  if (!env.BENCH_LIST_ID) {
    return json({ ok: false, error: { code: 'bench_not_configured', message: 'The talent bench is not available right now.' } }, 503, headers);
  }
  const url = new URL(request.url);
  const force = refreshKeyOk(env, url.searchParams.get('refresh'));
  try {
    const { snapshot, source } = await loadBench(env, force, ctx);
    // Browsers and shared caches may keep it for 5 minutes; the Worker itself re-reads SharePoint every 10.
    return json(
      { ok: true, source, updatedAt: snapshot.updatedAt, count: snapshot.profiles.length, profiles: snapshot.profiles },
      200,
      { ...headers, 'Cache-Control': force ? 'no-store' : 'public, max-age=300' },
    );
  } catch {
    return json({ ok: false, error: { code: 'bench_unavailable', message: 'The talent bench is not available right now. Please try again shortly.' } }, 503, headers);
  }
}
