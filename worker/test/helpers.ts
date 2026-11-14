import type { Env } from '../src/env';

const enc = new TextEncoder();

export function pdfBytes(size = 2048): Uint8Array {
  const b = new Uint8Array(size);
  b.set(enc.encode('%PDF-1.7\n'));
  b.set(enc.encode('%%EOF'), size - 5);
  return b;
}

/** A minimal ZIP-shaped buffer with the file names a real .docx contains. */
export function docxBytes(names = ['[Content_Types].xml', 'word/document.xml'], size = 4096): Uint8Array {
  const b = new Uint8Array(size);
  let pos = 0;
  for (const name of names) {
    b.set([0x50, 0x4b, 0x03, 0x04], pos);
    b.set(enc.encode(name), pos + 30);
    pos += 30 + name.length + 20;
  }
  b.set([0x50, 0x4b, 0x05, 0x06], size - 22);
  return b;
}

export function testEnv(overrides: Partial<Env> = {}, allow = true): Env {
  return {
    ALLOWED_ORIGINS: 'https://www.talnxt.com,https://talnxt.com',
    DRY_RUN: 'true',
    TURNSTILE_SECRET: 'test-secret',
    TENANT_ID: 'tenant',
    CLIENT_ID: 'client',
    CLIENT_SECRET: 'secret',
    SHAREPOINT_SITE_ID: 'site',
    ENQUIRY_LIST_ID: 'enq-list',
    CANDIDATE_LIST_ID: 'cand-list',
    RESUME_DRIVE_ID: 'drive',
    RESUME_FOLDER_PATH: 'Applications',
    MAIL_FROM: 'careers@talnxt.test',
    MAIL_TO: 'recruiter@talnxt.test',
    SUBMIT_LIMITER: { limit: async () => ({ success: allow }) },
    ...overrides,
  };
}

export function testCtx(): ExecutionContext & { pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext & { pending: Promise<unknown>[] };
}

export function enquiryForm(fields: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    enquiry_type: 'staffing',
    name: 'Asha Rao',
    company: 'Acme Pvt Ltd',
    email: 'asha@acme.example',
    phone: '98765 43210',
    roles: '2 Java developers',
    positions: '2',
    engagement_model: 'Contract (C2C)',
    start: 'Within 2 weeks',
    consent: 'on',
    website: '',
    page: '/index.html',
    'cf-turnstile-response': 'token-ok',
    ...fields,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

export function candidateForm(fields: Record<string, string> = {}, file: File | null = new File([pdfBytes()], 'My Resume.pdf', { type: 'application/pdf' })): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    role: 'Senior Java Developer (Contract, Bengaluru)',
    name: 'Rahul Verma',
    email: 'rahul@example.com',
    phone: '+91 98765 43210',
    location: 'Pune',
    experience: '6.5',
    notice: '30 days',
    linkedin: 'https://www.linkedin.com/in/rahul',
    consent: 'on',
    website: '',
    'cf-turnstile-response': 'token-ok',
    ...fields,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  if (file) f.set('resume', file);
  return f;
}

export function post(path: string, body: FormData, origin: string | null = 'https://www.talnxt.com'): Request {
  const headers: Record<string, string> = { 'CF-Connecting-IP': '203.0.113.7' };
  if (origin) headers.Origin = origin;
  return new Request(`https://forms.example.workers.dev${path}`, { method: 'POST', body, headers });
}
