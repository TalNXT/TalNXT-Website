import { candidateAck, digitalEnquiryAck, enquiryAck, notificationEmail } from './emails';
import { isDryRun, type Env } from './env';
import { detectResumeType, extensionOf, MAX_RESUME_BYTES } from './filetype';
import { createListItem, recipients, sendMail, uploadFile, type ListFields, type MailMessage } from './graph';
import { ApiError, logEvent } from './http';
import {
  CANDIDATE_RULES,
  DIGITAL_ENQUIRY_RULES,
  ENQUIRY_BASE_RULES,
  ENQUIRY_HR_RULES,
  ENQUIRY_STAFFING_RULES,
  hasConsent,
  validateFields,
  type Values,
} from './validate';

export interface Context {
  env: Env;
  ctx: ExecutionContext;
  submissionId: string;
  /** First allowed origin, used for links in acknowledgement emails. */
  siteUrl: string;
}

export interface Handler {
  /** Validates the form. Throws ApiError(400) on bad input. Runs before Turnstile verification. */
  validate(form: FormData): Promise<unknown>;
  /** Stores and notifies. Runs only after Turnstile has passed. */
  process(input: unknown, c: Context): Promise<void>;
}

function fail(errors: Record<string, string>): never {
  const first = Object.values(errors)[0] ?? 'Please check the form and try again.';
  throw new ApiError(400, 'validation_error', first, errors);
}

function requireConsent(form: FormData, errors: Record<string, string>): void {
  if (!hasConsent(form)) errors.consent = 'Please tick the consent box to continue.';
}

/**
 * Saves the list item and emails the recruiter in parallel. The submission counts as
 * received if at least one of them worked, so a lead is never silently lost.
 * The acknowledgement is sent after the response (waitUntil) and never fails the request.
 */
async function storeAndNotify(c: Context, listId: string, fields: ListFields, notification: MailMessage, ack: MailMessage, kind: string): Promise<void> {
  const [item, mail] = await Promise.allSettled([
    createListItem(c.env, listId, fields, `${kind}_list_item`),
    sendMail(c.env, notification, `${kind}_notification`),
  ]);
  for (const r of [item, mail]) {
    if (r.status === 'rejected') logEvent('error', 'graph_failed', { id: c.submissionId, reason: String(r.reason?.message ?? r.reason) });
  }
  if (item.status === 'rejected' && mail.status === 'rejected') {
    throw new ApiError(502, 'submit_failed', 'Sorry, we could not save your submission. Please try again shortly, or email us at info@talnxt.com.');
  }
  c.ctx.waitUntil(
    sendMail(c.env, ack, `${kind}_ack`).catch((e: Error) => logEvent('warn', 'ack_failed', { id: c.submissionId, reason: e.message })),
  );
}

// --- Enquiry ---------------------------------------------------------------

interface EnquiryInput {
  values: Values;
}

export const enquiry: Handler = {
  async validate(form) {
    const base = validateFields(form, ENQUIRY_BASE_RULES);
    const type = base.values.enquiry_type;
    const extra = type === 'hr' ? validateFields(form, ENQUIRY_HR_RULES) : type === 'staffing' ? validateFields(form, ENQUIRY_STAFFING_RULES) : { values: {}, errors: {} };
    const errors = { ...base.errors, ...extra.errors };
    requireConsent(form, errors);
    if (Object.keys(errors).length) fail(errors);
    return { values: { ...base.values, ...extra.values } } satisfies EnquiryInput;
  },

  async process(input, c) {
    const { values: v } = input as EnquiryInput;
    const isHr = v.enquiry_type === 'hr';
    if (isDryRun(c.env)) {
      logEvent('info', 'dry_run_enquiry', { id: c.submissionId, type: v.enquiry_type });
      return;
    }

    const fields: ListFields = {
      Title: v.company,
      SubmissionId: c.submissionId,
      EnquiryType: isHr ? 'HR' : 'Staffing',
      FullName: v.name,
      Company: v.company,
      Email: v.email,
      Phone: v.phone,
      Roles: v.roles,
      Positions: v.positions ? Number(v.positions) : undefined,
      EngagementModel: v.engagement_model,
      WorkLocation: v.location,
      NeededBy: v.start,
      HrArea: v.hr_area,
      CompanySize: v.company_size,
      Timeline: v.timeline,
      RequestedProfiles: v.profiles,
      Message: v.message,
      SourcePage: v.page,
      ConsentGiven: true,
    };

    const notification = notificationEmail({
      to: recipients(c.env.MAIL_TO),
      replyTo: v.email ?? '',
      submissionId: c.submissionId,
      subject: v.profiles ? `New Talent Bench request: ${v.company} (${v.profiles})` : `New ${isHr ? 'HR' : 'staffing'} enquiry: ${v.company}`,
      heading: `New ${isHr ? 'People & HR' : 'staffing'} enquiry`,
      rows: [
        ['Name', v.name],
        ['Company', v.company],
        ['Email', v.email],
        ['Phone', v.phone],
        ['Requested bench profiles', v.profiles],
        ['Role(s) / skills', v.roles],
        ['Positions', v.positions],
        ['Engagement model', v.engagement_model],
        ['Work location / mode', v.location],
        ['Needed by', v.start],
        ['Area of interest', v.hr_area],
        ['Company size', v.company_size],
        ['Timeline', v.timeline],
        ['Details', v.message],
        ['Submitted from', v.page],
      ],
    });

    await storeAndNotify(c, c.env.ENQUIRY_LIST_ID, fields, notification, enquiryAck(v.email ?? '', c.siteUrl), 'enquiry');
  },
};

// --- TalNXT Digital enquiry (talnxtdigital.com contact form) -----------------

/*
 * Saved in the same "Website Enquiries" list with EnquiryType "Digital", and notified to the
 * same MAIL_TO inbox from the same MAIL_FROM mailbox as the TalNXT enquiries.
 * Needs two extra list columns, CloudPlatform and ServiceInterest (docs/SETUP.md, section 11).
 */
export const digitalEnquiry: Handler = {
  async validate(form) {
    const { values, errors } = validateFields(form, DIGITAL_ENQUIRY_RULES);
    requireConsent(form, errors);
    if (Object.keys(errors).length) fail(errors);
    return { values } satisfies EnquiryInput;
  },

  async process(input, c) {
    const { values: v } = input as EnquiryInput;
    if (isDryRun(c.env)) {
      logEvent('info', 'dry_run_digital_enquiry', { id: c.submissionId });
      return;
    }

    const fields: ListFields = {
      Title: v.company || v.name,
      SubmissionId: c.submissionId,
      EnquiryType: 'Digital',
      FullName: v.name,
      Company: v.company,
      Email: v.email,
      CloudPlatform: v.platform,
      ServiceInterest: v.interest,
      Message: v.message,
      SourcePage: v.page ? `talnxtdigital.com${v.page}` : 'talnxtdigital.com',
      ConsentGiven: true,
    };

    const notification = notificationEmail({
      to: recipients(c.env.MAIL_TO),
      replyTo: v.email ?? '',
      submissionId: c.submissionId,
      subject: `New TalNXT Digital enquiry: ${v.company || v.name}`,
      heading: 'New TalNXT Digital enquiry',
      rows: [
        ['Name', v.name],
        ['Company', v.company],
        ['Email', v.email],
        ['Cloud platform', v.platform || 'Not sure yet'],
        ['Interested in', v.interest || 'Not sure yet'],
        ['Details', v.message],
        ['Submitted from', `talnxtdigital.com${v.page ?? ''}`],
      ],
    });

    await storeAndNotify(c, c.env.ENQUIRY_LIST_ID, fields, notification, digitalEnquiryAck(v.email ?? ''), 'digital_enquiry');
  },
};

// --- Candidate -------------------------------------------------------------

interface CandidateInput {
  values: Values;
  file: File;
  bytes: ArrayBuffer;
  ext: 'pdf' | 'docx';
  mime: string;
}

/** "Priya K. Sharma" -> "Priya-K-Sharma"; accents removed; max 40 characters. */
export function fileSafeName(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'candidate'
  );
}

/** Today's date in India (IST, UTC+5:30) as YYYY-MM-DD. */
export function istDate(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}

export const candidate: Handler = {
  async validate(form) {
    const { values, errors } = validateFields(form, CANDIDATE_RULES);
    requireConsent(form, errors);

    const file = form.get('resume');
    let resume: Omit<CandidateInput, 'values'> | null = null;
    if (!(file instanceof File) || file.size === 0) {
      errors.resume = 'Please upload your resume.';
    } else if (file.size > MAX_RESUME_BYTES) {
      errors.resume = 'Your resume must be 5 MB or smaller.';
    } else {
      const ext = extensionOf(file.name);
      const bytes = await file.arrayBuffer();
      const type = detectResumeType(new Uint8Array(bytes));
      if (!type || type.ext !== ext) errors.resume = 'Please upload your resume as a PDF or Word (.docx) file.';
      else resume = { file, bytes, ext: type.ext, mime: type.mime };
    }

    if (Object.keys(errors).length || !resume) fail(errors);
    return { values, ...resume } satisfies CandidateInput;
  },

  async process(input, c) {
    const { values: v, bytes, ext, mime } = input as CandidateInput;
    const fileName = `${istDate()}_${fileSafeName(v.name ?? '')}_${c.submissionId}.${ext}`;
    if (isDryRun(c.env)) {
      logEvent('info', 'dry_run_candidate', { id: c.submissionId, ext, bytes: bytes.byteLength });
      return;
    }

    // The resume must be stored before anything else; if this fails the visitor is asked to retry.
    const uploaded = await uploadFile(c.env, fileName, bytes, mime);

    const fields: ListFields = {
      Title: v.name,
      SubmissionId: c.submissionId,
      Email: v.email,
      Phone: v.phone,
      Role: v.role,
      CurrentLocation: v.location,
      ExperienceYears: v.experience ? Number(v.experience) : undefined,
      NoticePeriod: v.notice,
      LinkedInUrl: v.linkedin,
      Message: v.message,
      ResumeUrl: uploaded.webUrl,
      ResumeFileName: fileName,
      SourcePage: v.page,
      ConsentGiven: true,
    };

    const notification = notificationEmail({
      to: recipients(c.env.MAIL_TO),
      replyTo: v.email ?? '',
      submissionId: c.submissionId,
      subject: `New application: ${v.role} - ${v.name}`,
      heading: 'New candidate application',
      rows: [
        ['Role', v.role],
        ['Name', v.name],
        ['Email', v.email],
        ['Phone', v.phone],
        ['Current location', v.location],
        ['Experience', v.experience ? `${v.experience} years` : undefined],
        ['Notice period', v.notice],
        ['LinkedIn', v.linkedin],
        ['Message', v.message],
        ['Resume file', fileName],
      ],
      link: { label: 'Open resume in SharePoint', url: uploaded.webUrl },
    });

    await storeAndNotify(c, c.env.CANDIDATE_LIST_ID, fields, notification, candidateAck(v.email ?? '', c.siteUrl), 'candidate');
  },
};
