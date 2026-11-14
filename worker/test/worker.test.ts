import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { resetTokenCache } from '../src/graph';
import { candidateForm, docxBytes, enquiryForm, post, testCtx, testEnv } from './helpers';

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
}

let calls: Call[];
let logs: string[];
let graphFailures: Record<string, number>;

/** Fake Turnstile, Entra token endpoint and Graph. */
async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const method = init.method ?? 'GET';
  const body = init.body;
  calls.push({ url, method, body, headers: new Headers(init.headers) });

  if (url.includes('turnstile/v0/siteverify')) {
    const token = (body as URLSearchParams).get('response');
    return Response.json({ success: token === 'token-ok', 'error-codes': token === 'token-ok' ? [] : ['invalid-input-response'] });
  }
  if (url.startsWith('https://login.microsoftonline.com/')) {
    return Response.json({ access_token: 'graph-token', expires_in: 3599 });
  }
  for (const [frag, status] of Object.entries(graphFailures)) {
    if (url.includes(frag)) return Response.json({ error: { code: 'accessDenied', message: 'Contains asha@acme.example' } }, { status });
  }
  if (method === 'PUT' && url.includes('/content')) {
    return Response.json({ id: 'file-1', webUrl: 'https://tenant.sharepoint.com/sites/hr/Resumes/file.pdf' }, { status: 201 });
  }
  if (method === 'POST' && url.includes('/items')) return Response.json({ id: '42' }, { status: 201 });
  if (method === 'POST' && url.endsWith('/sendMail')) return new Response(null, { status: 202 });
  return new Response('unexpected', { status: 500 });
}

beforeEach(() => {
  calls = [];
  logs = [];
  graphFailures = {};
  resetTokenCache();
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function run(req: Request, env = testEnv()) {
  const ctx = testCtx();
  const res = await worker.fetch(req as never, env, ctx);
  await Promise.all(ctx.pending);
  const body = (await res.json().catch(() => null)) as { ok: boolean; id?: string; error?: { code: string; message: string; fields?: Record<string, string> } } | null;
  return { res, body };
}

const PII = ['Asha', 'asha@acme', '98765', 'Rahul', 'rahul@example', 'Acme'];
const expectNoPiiInLogs = () => {
  for (const line of logs) for (const p of PII) expect(line).not.toContain(p);
};

describe('routing and CORS', () => {
  it('answers the health check', async () => {
    const { res, body } = await run(new Request('https://x.workers.dev/api/health'));
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it('returns 404 for unknown paths', async () => {
    const { res } = await run(new Request('https://x.workers.dev/nope'));
    expect(res.status).toBe(404);
  });

  it('handles preflight for allowed origins only', async () => {
    const ok = await worker.fetch(
      new Request('https://x.workers.dev/api/enquiry', { method: 'OPTIONS', headers: { Origin: 'https://talnxt.com' } }) as never,
      testEnv(),
      testCtx(),
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://talnxt.com');

    const bad = await worker.fetch(
      new Request('https://x.workers.dev/api/enquiry', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }) as never,
      testEnv(),
      testCtx(),
    );
    expect(bad.status).toBe(403);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects POSTs from other or missing origins', async () => {
    for (const origin of ['https://evil.example', 'https://www.talnxt.com.evil.example', null]) {
      const { res, body } = await run(post('/api/enquiry', enquiryForm(), origin));
      expect(res.status).toBe(403);
      expect(body?.error?.code).toBe('forbidden_origin');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('rejects non-multipart bodies and GET on form routes', async () => {
    const json = new Request('https://x.workers.dev/api/enquiry', {
      method: 'POST',
      body: '{}',
      headers: { Origin: 'https://www.talnxt.com', 'Content-Type': 'application/json' },
    });
    expect((await run(json)).res.status).toBe(415);
    const get = new Request('https://x.workers.dev/api/enquiry', { headers: { Origin: 'https://www.talnxt.com' } });
    expect((await run(get)).res.status).toBe(405);
  });
});

describe('protection', () => {
  it('rate-limits', async () => {
    const { res, body } = await run(post('/api/enquiry', enquiryForm()), testEnv({}, false));
    expect(res.status).toBe(429);
    expect(body?.error?.code).toBe('rate_limited');
  });

  it('fakes success for honeypot hits and does nothing else', async () => {
    const { res, body } = await run(post('/api/enquiry', enquiryForm({ website: 'http://spam.example' })), testEnv({ DRY_RUN: 'false' }));
    expect(res.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('rejects a failed Turnstile check', async () => {
    const { res, body } = await run(post('/api/enquiry', enquiryForm({ 'cf-turnstile-response': 'bad' })));
    expect(res.status).toBe(403);
    expect(body?.error?.code).toBe('verification_failed');
  });

  it('rejects a missing Turnstile token without calling Cloudflare', async () => {
    const f = enquiryForm();
    f.delete('cf-turnstile-response');
    const { res } = await run(post('/api/enquiry', f));
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('validates before spending the Turnstile token', async () => {
    const { res, body } = await run(post('/api/enquiry', enquiryForm({ email: 'nope', phone: '123' })));
    expect(res.status).toBe(400);
    expect(body?.error?.code).toBe('validation_error');
    expect(Object.keys(body?.error?.fields ?? {}).sort()).toEqual(['email', 'phone']);
    expect(calls).toHaveLength(0);
  });
});

describe('POST /api/enquiry', () => {
  it('accepts a staffing enquiry in dry-run mode', async () => {
    const { res, body } = await run(post('/api/enquiry', enquiryForm()));
    expect(res.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(body?.id).toMatch(/^[a-z2-9]{10}$/);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.talnxt.com');
  });

  it('requires the HR fields for HR enquiries and ignores staffing ones', async () => {
    const { res, body } = await run(post('/api/enquiry', enquiryForm({ enquiry_type: 'hr', roles: '' })));
    expect(res.status).toBe(400);
    expect(Object.keys(body?.error?.fields ?? {})).toEqual(['hr_area']);
    const ok = await run(post('/api/enquiry', enquiryForm({ enquiry_type: 'hr', roles: '', hr_area: 'HR Tech & AI Adoption', company_size: '51–200 employees' })));
    expect(ok.res.status).toBe(200);
  });

  it('requires consent', async () => {
    const f = enquiryForm();
    f.delete('consent');
    const { body } = await run(post('/api/enquiry', f));
    expect(body?.error?.fields?.consent).toBeDefined();
  });

  it('stores the item, notifies the recruiter and acknowledges the sender via Graph', async () => {
    const { res } = await run(post('/api/enquiry', enquiryForm({ message: '<script>alert(1)</script>' })), testEnv({ DRY_RUN: 'false' }));
    expect(res.status).toBe(200);

    const item = calls.find((c) => c.url.includes('/lists/enq-list/items'));
    const fields = JSON.parse(String(item?.body)).fields;
    expect(fields).toMatchObject({ Title: 'Acme Pvt Ltd', EnquiryType: 'Staffing', Phone: '+919876543210', Positions: 2, ConsentGiven: true });
    expect(fields.HrArea).toBeUndefined();
    expect(item?.headers.get('Authorization')).toBe('Bearer graph-token');

    const mails = calls.filter((c) => c.url.endsWith('/users/careers%40talnxt.test/sendMail')).map((c) => JSON.parse(String(c.body)));
    expect(mails).toHaveLength(2);
    const [notify, ack] = mails;
    expect(notify.message.toRecipients[0].emailAddress.address).toBe('recruiter@talnxt.test');
    expect(notify.message.replyTo[0].emailAddress.address).toBe('asha@acme.example');
    expect(notify.message.body.content).toContain('&lt;script&gt;');
    expect(notify.message.body.content).not.toContain('<script>');
    expect(notify.saveToSentItems).toBe(false);
    expect(ack.message.toRecipients[0].emailAddress.address).toBe('asha@acme.example');
    expect(ack.message.body.content).not.toContain('Asha');
    expect(ack.message.body.content).not.toContain('alert');
    expectNoPiiInLogs();
  });

  it('still succeeds if only the list write fails (the email carries the lead)', async () => {
    graphFailures['/items'] = 403;
    const { res } = await run(post('/api/enquiry', enquiryForm()), testEnv({ DRY_RUN: 'false' }));
    expect(res.status).toBe(200);
    expect(logs.some((l) => l.includes('graph_failed'))).toBe(true);
    expectNoPiiInLogs();
  });

  it('fails cleanly when both the list write and the recruiter email fail', async () => {
    graphFailures['/items'] = 403;
    graphFailures['/sendMail'] = 403;
    const { res, body } = await run(post('/api/enquiry', enquiryForm()), testEnv({ DRY_RUN: 'false' }));
    expect(res.status).toBe(502);
    expect(body?.error?.code).toBe('submit_failed');
    expect(JSON.stringify(body)).not.toContain('accessDenied');
    expectNoPiiInLogs();
  });
});

describe('POST /api/candidate', () => {
  it('accepts a PDF resume in dry-run mode', async () => {
    const { res, body } = await run(post('/api/candidate', candidateForm()));
    expect(res.status).toBe(200);
    expect(body?.ok).toBe(true);
  });

  it('accepts a DOCX resume', async () => {
    const file = new File([docxBytes()], 'cv.docx');
    const { res } = await run(post('/api/candidate', candidateForm({}, file)));
    expect(res.status).toBe(200);
  });

  it.each([
    ['a missing resume', null, 'Please upload your resume.'],
    ['a renamed executable', new File([Uint8Array.of(0x4d, 0x5a, 0x90, 0, 1, 2)], 'cv.pdf'), 'PDF or Word'],
    ['a PDF named .docx', new File([new TextEncoder().encode('%PDF-1.4 ...')], 'cv.docx'), 'PDF or Word'],
    ['a legacy .doc', new File([Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)], 'cv.doc'), 'PDF or Word'],
    ['a file over 5 MB', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'cv.pdf'), '5 MB'],
  ])('rejects %s', async (_label, file, message) => {
    const { res, body } = await run(post('/api/candidate', candidateForm({}, file as File | null)));
    expect(res.status === 400 || res.status === 413).toBe(true);
    expect(body?.error?.message).toContain(message);
  });

  it('uploads the resume, stores the item with the link, and emails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
    try {
      const { res, body } = await run(post('/api/candidate', candidateForm()), testEnv({ DRY_RUN: 'false' }));
      expect(res.status).toBe(200);

      const upload = calls.find((c) => c.method === 'PUT');
      expect(upload?.url).toBe(
        `https://graph.microsoft.com/v1.0/drives/drive/root:/Applications/2026-11-14_Rahul-Verma_${body?.id}.pdf:/content?@microsoft.graph.conflictBehavior=rename`,
      );
      expect(upload?.headers.get('Content-Type')).toBe('application/pdf');

      const item = calls.find((c) => c.url.includes('/lists/cand-list/items'));
      expect(JSON.parse(String(item?.body)).fields).toMatchObject({
        Title: 'Rahul Verma',
        Role: 'Senior Java Developer (Contract, Bengaluru)',
        ExperienceYears: 6.5,
        ResumeUrl: 'https://tenant.sharepoint.com/sites/hr/Resumes/file.pdf',
        ResumeFileName: `2026-11-14_Rahul-Verma_${body?.id}.pdf`,
      });
      expect(calls.filter((c) => c.url.endsWith('/sendMail'))).toHaveLength(2);
      // token fetched once and reused
      expect(calls.filter((c) => c.url.includes('login.microsoftonline.com'))).toHaveLength(1);
      expectNoPiiInLogs();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns a generic error (no internals) when the upload fails', async () => {
    graphFailures['/content'] = 403;
    const { res, body } = await run(post('/api/candidate', candidateForm()), testEnv({ DRY_RUN: 'false' }));
    expect(res.status).toBe(502);
    expect(body?.error?.code).toBe('server_error');
    expect(JSON.stringify(body)).not.toMatch(/graph|accessDenied|sharepoint/i);
    expect(calls.some((c) => c.url.includes('/items'))).toBe(false);
    expectNoPiiInLogs();
  });
});
