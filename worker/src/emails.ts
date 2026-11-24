import type { MailMessage } from './graph';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

const oneLine = (s: string, max = 120): string => s.replace(/\s+/g, ' ').trim().slice(0, max);

const wrap = (inner: string): string =>
  `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#14203a;max-width:640px">${inner}</div>`;

/** Recruiter-facing table. Every value is escaped; line breaks in long text are kept. */
function table(rows: [string, string | undefined][]): string {
  const tr = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#58657a;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td>` +
        `<td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(v ?? '')}</td></tr>`,
    )
    .join('');
  return `<table style="border-collapse:collapse">${tr}</table>`;
}

export interface NotificationInput {
  subject: string;
  heading: string;
  rows: [string, string | undefined][];
  link?: { label: string; url: string };
  submissionId: string;
  to: string[];
  replyTo: string;
}

export function notificationEmail(n: NotificationInput): MailMessage {
  const link = n.link
    ? `<p><a href="${escapeHtml(n.link.url)}" style="color:#1b5fc4;font-weight:600">${escapeHtml(n.link.label)}</a></p>`
    : '';
  return {
    to: n.to,
    replyTo: n.replyTo,
    subject: oneLine(n.subject, 200),
    html: wrap(
      `<h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(n.heading)}</h2>${table(n.rows)}${link}` +
        `<p style="color:#58657a;font-size:12px">Reference: ${escapeHtml(n.submissionId)}. Use Reply to respond to the sender directly.</p>`,
    ),
  };
}

/*
 * Acknowledgement emails go to an address typed into a public form, so they use a FIXED
 * template that never repeats anything the visitor typed. That way the form cannot be used
 * to send arbitrary content from our mailbox.
 */
export function enquiryAck(to: string, siteUrl: string): MailMessage {
  return {
    to: [to],
    subject: 'We have received your enquiry - TalNXT Technologies',
    html: wrap(
      `<p>Hello,</p>` +
        `<p>Thank you for contacting TalNXT Technologies. We have received your enquiry, and a member of our team will get back to you within one business day.</p>` +
        `<p>If you need to add anything in the meantime, simply reply to this email.</p>` +
        `<p>Regards,<br>Team TalNXT<br><a href="${escapeHtml(siteUrl)}" style="color:#1b5fc4">${escapeHtml(siteUrl.replace(/^https?:\/\//, ''))}</a></p>` +
        `<p style="color:#58657a;font-size:12px">You are receiving this because this email address was entered in the enquiry form on our website. If that was not you, please ignore this message. How we handle your data: <a href="${escapeHtml(siteUrl)}/privacy.html">Privacy Policy</a>.</p>`,
    ),
  };
}

/** Public address of the TalNXT Digital site, used in its acknowledgement email. */
export const DIGITAL_SITE_URL = 'https://talnxtdigital.com';
/** TalNXT Digital has no privacy page of its own; it is a TalNXT Technologies company and uses the group policy. */
const GROUP_PRIVACY_URL = 'https://www.talnxt.com/privacy.html';

export function digitalEnquiryAck(to: string): MailMessage {
  return {
    to: [to],
    subject: 'We have received your enquiry - TalNXT Digital',
    html: wrap(
      `<p>Hello,</p>` +
        `<p>Thank you for contacting TalNXT Digital. We have received your enquiry, and a member of our cloud team will get back to you within one business day.</p>` +
        `<p>If you need to add anything in the meantime, simply reply to this email.</p>` +
        `<p>Regards,<br>Team TalNXT Digital<br><a href="${DIGITAL_SITE_URL}" style="color:#1b5fc4">${DIGITAL_SITE_URL.replace(/^https?:\/\//, '')}</a></p>` +
        `<p style="color:#58657a;font-size:12px">You are receiving this because this email address was entered in the contact form on our website. If that was not you, please ignore this message. TalNXT Digital is a TalNXT Technologies company. How we handle your data: <a href="${GROUP_PRIVACY_URL}">Privacy Policy</a>.</p>`,
    ),
  };
}

export function candidateAck(to: string, siteUrl: string): MailMessage {
  return {
    to: [to],
    subject: 'We have received your application - TalNXT Technologies',
    html: wrap(
      `<p>Hello,</p>` +
        `<p>Thank you for applying through TalNXT Technologies. We have received your details and resume. Our recruitment team reviews every application, and we will contact you if your profile matches a current or upcoming role.</p>` +
        `<p>Regards,<br>Talent Team, TalNXT<br><a href="${escapeHtml(siteUrl)}" style="color:#1b5fc4">${escapeHtml(siteUrl.replace(/^https?:\/\//, ''))}</a></p>` +
        `<p style="color:#58657a;font-size:12px">You are receiving this because this email address was entered in the application form on our website. If that was not you, please ignore this message. How we handle your data, including how to ask us to delete it: <a href="${escapeHtml(siteUrl)}/privacy.html">Privacy Policy</a>.</p>`,
    ),
  };
}
