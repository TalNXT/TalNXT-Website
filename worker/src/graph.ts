import type { Env } from './env';

/*
 * Microsoft Graph with app-only (client credentials) auth. Required permissions:
 *   - Sites.Selected (application), granted "write" on the one SharePoint site
 *   - Mail.Send, limited to MAIL_FROM via Exchange RBAC for Applications
 * See docs/SETUP.md.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Carries only the stage, HTTP status and Graph error code, never request or response bodies. */
export class GraphError extends Error {
  constructor(
    readonly stage: string,
    readonly status: number,
    readonly graphCode?: string,
  ) {
    super(`${stage} failed (${status}${graphCode ? ` ${graphCode}` : ''})`);
  }
}

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

/** Exposed for tests. */
export function resetTokenCache(): void {
  cachedToken = null;
}

async function getToken(env: Env): Promise<string> {
  const key = `${env.TENANT_ID}:${env.CLIENT_ID}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GraphError('token', res.status, err.error);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh 5 minutes early. The cache lives only as long as this Worker isolate.
  cachedToken = { key, token: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
  return data.access_token;
}

async function graphRequest(env: Env, stage: string, method: string, path: string, body?: BodyInit, contentType?: string, timeoutMs = 15_000): Promise<Response> {
  const token = await getToken(env);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (contentType) headers['Content-Type'] = contentType;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GRAPH}${path}`, {
      method,
      body,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return res;

    // One retry on throttling or transient errors, waiting at most 2 seconds.
    if (attempt === 0 && (res.status === 429 || res.status === 503 || res.status === 504)) {
      const retryAfter = Math.min(Number(res.headers.get('Retry-After')) || 1, 2);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    const err = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    throw new GraphError(stage, res.status, err.error?.code);
  }
}

const encodePath = (p: string): string =>
  p
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');

/** Uploads a file (up to 250 MB with a single PUT; ours are 5 MB at most). */
export async function uploadFile(env: Env, fileName: string, bytes: ArrayBuffer, mime: string): Promise<{ id: string; webUrl: string }> {
  const folder = encodePath(env.RESUME_FOLDER_PATH ?? '');
  const itemPath = folder ? `${folder}/${encodeURIComponent(fileName)}` : encodeURIComponent(fileName);
  const res = await graphRequest(
    env,
    'upload_resume',
    'PUT',
    `/drives/${encodeURIComponent(env.RESUME_DRIVE_ID)}/root:/${itemPath}:/content?@microsoft.graph.conflictBehavior=rename`,
    bytes,
    mime,
    30_000,
  );
  const item = (await res.json()) as { id: string; webUrl: string };
  return { id: item.id, webUrl: item.webUrl };
}

export type ListFields = Record<string, string | number | boolean | undefined>;

/** Creates a SharePoint list item. Empty values are left out so optional columns stay blank. */
export async function createListItem(env: Env, listId: string, fields: ListFields, stage: string): Promise<{ id: string }> {
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') clean[k] = v;
  const res = await graphRequest(
    env,
    stage,
    'POST',
    `/sites/${encodeURIComponent(env.SHAREPOINT_SITE_ID)}/lists/${encodeURIComponent(listId)}/items`,
    JSON.stringify({ fields: clean }),
    'application/json',
  );
  const item = (await res.json()) as { id: string };
  return { id: item.id };
}

/**
 * Reads every item of a SharePoint list (following @odata.nextLink pages) and returns each
 * item's `fields`, limited to `select` plus the item's lastModifiedDateTime as `_modified`.
 */
export async function listItems(env: Env, listId: string, select: readonly string[], stage: string, maxPages = 20): Promise<Record<string, unknown>[]> {
  const query = `$top=500&$select=id,lastModifiedDateTime&$expand=fields($select=${select.map(encodeURIComponent).join(',')})`;
  let path: string | null = `/sites/${encodeURIComponent(env.SHAREPOINT_SITE_ID)}/lists/${encodeURIComponent(listId)}/items?${query}`;
  const out: Record<string, unknown>[] = [];
  for (let page = 0; path && page < maxPages; page++) {
    const res = await graphRequest(env, stage, 'GET', path);
    const data = (await res.json()) as {
      value?: { lastModifiedDateTime?: string; fields?: Record<string, unknown> }[];
      '@odata.nextLink'?: string;
    };
    for (const item of data.value ?? []) out.push({ ...(item.fields ?? {}), _modified: item.lastModifiedDateTime });
    const next = data['@odata.nextLink'];
    // nextLink is an absolute Graph URL; only follow it if it stays on Graph.
    path = next && next.startsWith(GRAPH) ? next.slice(GRAPH.length) : null;
  }
  return out;
}

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
}

/** Sends from MAIL_FROM. Not saved to Sent Items, so no extra copies of personal data are kept. */
export async function sendMail(env: Env, msg: MailMessage, stage: string): Promise<void> {
  const addr = (address: string) => ({ emailAddress: { address } });
  await graphRequest(
    env,
    stage,
    'POST',
    `/users/${encodeURIComponent(env.MAIL_FROM)}/sendMail`,
    JSON.stringify({
      message: {
        subject: msg.subject,
        body: { contentType: 'HTML', content: msg.html },
        toRecipients: msg.to.map(addr),
        ...(msg.replyTo ? { replyTo: [addr(msg.replyTo)] } : {}),
      },
      saveToSentItems: false,
    }),
    'application/json',
  );
}

export const recipients = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
