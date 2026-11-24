/*
 * Server-side validation. Rules mirror the forms in index.html, contingent-staffing.html,
 * people-hr-solutions.html (enquiry) and careers.html (candidate).
 * IMPORTANT: select options below must match the <option> text in the HTML exactly.
 */

type Kind = 'text' | 'multiline' | 'name' | 'email' | 'phone' | 'url' | 'int' | 'decimal' | 'path' | 'idlist';

export interface FieldRule {
  label: string;
  kind: Kind;
  max: number;
  required?: boolean;
  options?: readonly string[];
  range?: readonly [number, number];
  /** decimal only: value must be a multiple of this */
  step?: number;
}

export type Rules = Record<string, FieldRule>;
export type Values = Record<string, string>;

const NDASH = '–';

export const OPTIONS = {
  enquiryType: ['staffing', 'hr'],
  engagementModel: ['Contract (C2C)', 'Contract-to-hire (C2H)', 'Permanent', 'Not sure yet'],
  neededBy: ['Immediately', 'Within 2 weeks', 'Within a month', `1${NDASH}3 months`],
  hrArea: [
    'Workforce Strategy & Planning',
    'HR Outsourcing & Operations',
    'Organisation & People Transformation',
    'HR Advisory & Fractional HR Leadership',
    'HR Tech & AI Adoption',
    'Not sure yet',
  ],
  companySize: [`1${NDASH}50 employees`, `51${NDASH}200 employees`, `201${NDASH}1,000 employees`, '1,000+ employees'],
  timeline: ['Immediately', 'Within a month', `1${NDASH}3 months`, 'Just exploring'],
  notice: ['Immediate', '15 days', '30 days', '60 days', '90 days'],
  // TalNXT Digital contact form (talnxtdigital.com/contact.html)
  cloudPlatform: ['AWS', 'Microsoft Azure', 'Both', 'Other'],
  digitalInterest: [
    'Cloud Assessment & Migration',
    'Cloud FinOps',
    'Cloud Security',
    'Governance & Compliance',
    'DevOps & DevSecOps',
    'Cloud Automation',
    'Zero-Cost Cloud Assessment',
    'Other',
  ],
} as const;

const common: Rules = {
  name: { label: 'Full name', kind: 'name', max: 100, required: true },
  email: { label: 'Email', kind: 'email', max: 254, required: true },
  phone: { label: 'Phone', kind: 'phone', max: 20, required: true },
  message: { label: 'Additional details', kind: 'multiline', max: 2000 },
  page: { label: 'Page', kind: 'path', max: 200 },
};

export const ENQUIRY_BASE_RULES: Rules = {
  enquiry_type: { label: "I'm looking for", kind: 'text', max: 20, required: true, options: OPTIONS.enquiryType },
  company: { label: 'Company', kind: 'text', max: 150, required: true },
  ...common,
};

export const ENQUIRY_STAFFING_RULES: Rules = {
  roles: { label: 'Role(s) / skills required', kind: 'multiline', max: 500, required: true },
  positions: { label: 'Number of positions', kind: 'int', max: 3, range: [1, 500] },
  engagement_model: { label: 'Engagement model', kind: 'text', max: 50, options: OPTIONS.engagementModel },
  location: { label: 'Work location / mode', kind: 'text', max: 100 },
  start: { label: 'Needed by', kind: 'text', max: 50, options: OPTIONS.neededBy },
  /** Talent Bench profile IDs the client shortlisted (talent-bench.html), comma-separated. */
  profiles: { label: 'Requested profiles', kind: 'idlist', max: 500 },
};

export const ENQUIRY_HR_RULES: Rules = {
  hr_area: { label: 'Area of interest', kind: 'text', max: 100, required: true, options: OPTIONS.hrArea },
  company_size: { label: 'Company size', kind: 'text', max: 50, options: OPTIONS.companySize },
  timeline: { label: 'Timeline', kind: 'text', max: 50, options: OPTIONS.timeline },
};

/** TalNXT Digital "Get in touch" form. Phone is not asked for; platform and interest are optional ("Not sure yet" sends ""). */
export const DIGITAL_ENQUIRY_RULES: Rules = {
  name: { label: 'Your name', kind: 'name', max: 100, required: true },
  email: { label: 'Work email', kind: 'email', max: 254, required: true },
  company: { label: 'Company', kind: 'text', max: 150 },
  platform: { label: 'Cloud platform', kind: 'text', max: 50, options: OPTIONS.cloudPlatform },
  interest: { label: "I'm interested in", kind: 'text', max: 100, options: OPTIONS.digitalInterest },
  message: { label: 'Tell us more', kind: 'multiline', max: 2000 },
  page: { label: 'Page', kind: 'path', max: 200 },
};

export const CANDIDATE_RULES: Rules = {
  role: { label: 'Role', kind: 'text', max: 200, required: true },
  ...common,
  message: { label: 'Anything else', kind: 'multiline', max: 2000 },
  location: { label: 'Current location', kind: 'text', max: 100 },
  experience: { label: 'Total experience', kind: 'decimal', max: 4, range: [0, 50], step: 0.5 },
  notice: { label: 'Notice period', kind: 'text', max: 20, options: OPTIONS.notice },
  linkedin: { label: 'LinkedIn profile', kind: 'url', max: 255 },
};

// ---------------------------------------------------------------------------

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/**
 * India-friendly phone check. Accepts, after removing spaces, dashes, dots and brackets:
 *  - Indian mobiles: 9876543210, 09876543210, 919876543210, +919876543210
 *  - Indian landlines with STD code: 08012345678
 *  - Other countries in international format: +44 20 7946 0958 (8–15 digits after "+")
 * Returns a normalised form (+91XXXXXXXXXX for Indian mobiles), or null if invalid.
 */
export function normalisePhone(raw: string): string | null {
  const s = raw.replace(/[\s\-.()]/g, '');
  let m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(s);
  if (m) return `+91${m[1]}`;
  m = /^0(\d{10})$/.exec(s);
  if (m) return `+91${m[1]}`;
  if (/^\+(?!91)[1-9]\d{7,14}$/.test(s)) return s;
  return null;
}

export function isValidEmail(value: string): boolean {
  if (value.length > 254 || !EMAIL_RE.test(value)) return false;
  const [local] = value.split('@');
  return !!local && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
}

/** Trim, NFC-normalise and strip control characters (keeping line breaks in multi-line fields). */
function clean(value: string, multiline: boolean): string {
  let v = value.normalize('NFC').replace(/\r\n?/g, '\n');
  // eslint-disable-next-line no-control-regex
  v = multiline ? v.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '') : v.replace(/[\u0000-\u001F\u007F]+/g, ' ');
  v = multiline ? v.replace(/\n{3,}/g, '\n\n') : v.replace(/\s+/g, ' ');
  return v.trim();
}

function checkField(rule: FieldRule, raw: string): { value: string } | { error: string } {
  const value = clean(raw, rule.kind === 'multiline');
  if (!value) return rule.required ? { error: `${rule.label} is required.` } : { value: '' };
  if (value.length > rule.max) return { error: `${rule.label} must be ${rule.max} characters or fewer.` };
  if (rule.options && !rule.options.includes(value)) return { error: `Please choose a valid option for ${rule.label}.` };

  switch (rule.kind) {
    case 'name':
      if (value.length < 2 || !NAME_RE.test(value)) return { error: 'Please enter your full name using letters only.' };
      return { value };
    case 'email':
      return isValidEmail(value) ? { value: value.toLowerCase() } : { error: 'Please enter a valid email address.' };
    case 'phone': {
      const phone = normalisePhone(value);
      return phone
        ? { value: phone }
        : { error: 'Please enter a valid phone number, e.g. 98765 43210, or +44 20 7946 0958 for numbers outside India.' };
    }
    case 'url': {
      let url: URL;
      try {
        url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      } catch {
        return { error: `Please enter ${rule.label} as a full link (https://…).` };
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: `Please enter ${rule.label} as a full link (https://…).` };
      return { value: url.href.slice(0, rule.max) };
    }
    case 'int': {
      if (!/^\d+$/.test(value)) return { error: `${rule.label} must be a whole number.` };
      const n = Number(value);
      if (rule.range && (n < rule.range[0] || n > rule.range[1])) return { error: `${rule.label} must be between ${rule.range[0]} and ${rule.range[1]}.` };
      return { value: String(n) };
    }
    case 'decimal': {
      if (!/^\d+(?:\.\d+)?$/.test(value)) return { error: `${rule.label} must be a number.` };
      const n = Number(value);
      if (rule.range && (n < rule.range[0] || n > rule.range[1])) return { error: `${rule.label} must be between ${rule.range[0]} and ${rule.range[1]}.` };
      if (rule.step && Math.abs(n / rule.step - Math.round(n / rule.step)) > 1e-9) return { error: `${rule.label} must be in steps of ${rule.step}.` };
      return { value: String(n) };
    }
    case 'idlist': {
      const ids = [...new Set(value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
      if (ids.length > 25 || !ids.every((id) => /^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(id))) return { error: `${rule.label} are not valid.` };
      return { value: ids.join(', ') };
    }
    case 'path':
      return /^\/[A-Za-z0-9/_.\-#?=&%]*$/.test(value) ? { value } : { value: '' };
    default:
      return { value };
  }
}

export interface ValidationResult {
  values: Values;
  errors: Record<string, string>;
}

export function validateFields(form: FormData, rules: Rules): ValidationResult {
  const values: Values = {};
  const errors: Record<string, string> = {};
  for (const [name, rule] of Object.entries(rules)) {
    const raw = form.get(name);
    if (raw !== null && typeof raw !== 'string') {
      errors[name] = `${rule.label} is not valid.`;
      continue;
    }
    const result = checkField(rule, raw ?? '');
    if ('error' in result) errors[name] = result.error;
    else values[name] = result.value;
  }
  return { values, errors };
}

/** Consent checkbox must be ticked (browsers send "on" by default). */
export function hasConsent(form: FormData): boolean {
  const v = form.get('consent');
  return typeof v === 'string' && v.length > 0 && v.length <= 10;
}

export const HONEYPOT_FIELD = 'website';

/** True when the hidden honeypot input was filled in (bots fill every field). */
export function isHoneypotTripped(form: FormData): boolean {
  const v = form.get(HONEYPOT_FIELD);
  return v !== null && (typeof v !== 'string' || v.trim() !== '');
}
