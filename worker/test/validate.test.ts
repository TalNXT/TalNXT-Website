import { describe, expect, it } from 'vitest';
import { detectResumeType, extensionOf } from '../src/filetype';
import { fileSafeName, istDate } from '../src/handlers';
import { CANDIDATE_RULES, isValidEmail, normalisePhone, validateFields, isHoneypotTripped } from '../src/validate';
import { escapeHtml } from '../src/emails';
import { docxBytes, pdfBytes } from './helpers';

describe('normalisePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['91-9876543210', '+919876543210'],
    ['(080) 1234 5678', '+918012345678'],
    ['+44 20 7946 0958', '+442079460958'],
    ['+1 (415) 555-0100', '+14155550100'],
  ])('accepts %s', (input, expected) => expect(normalisePhone(input)).toBe(expected));

  it.each(['12345', '5876543210', '+91 5876543210', 'abcdefghij', '+0123456789', '98765432101234567', ''])('rejects %s', (input) =>
    expect(normalisePhone(input)).toBeNull(),
  );
});

describe('isValidEmail', () => {
  it.each(['a@b.co', 'first.last+tag@sub.example.in'])('accepts %s', (e) => expect(isValidEmail(e)).toBe(true));
  it.each(['plain', 'a@b', 'a@@b.com', '.a@b.com', 'a..b@c.com', 'a b@c.com', `${'x'.repeat(65)}@b.com`])('rejects %s', (e) =>
    expect(isValidEmail(e)).toBe(false),
  );
});

describe('validateFields (candidate)', () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ role: 'General application', name: 'Ana', email: 'a@b.co', phone: '9876543210', ...o })) f.set(k, v);
    return f;
  };

  it('passes a minimal valid form and normalises values', () => {
    const r = validateFields(form({ email: 'Ana@B.CO', linkedin: 'linkedin.com/in/ana' }), CANDIDATE_RULES);
    expect(r.errors).toEqual({});
    expect(r.values.email).toBe('ana@b.co');
    expect(r.values.phone).toBe('+919876543210');
    expect(r.values.linkedin).toBe('https://linkedin.com/in/ana');
  });

  it('flags missing required fields, bad options, length and number rules', () => {
    const r = validateFields(
      form({ name: '', notice: '1 year', experience: '3.3', message: 'x'.repeat(2001), linkedin: 'javascript:alert(1)' }),
      CANDIDATE_RULES,
    );
    expect(Object.keys(r.errors).sort()).toEqual(['experience', 'linkedin', 'message', 'name', 'notice']);
  });

  it('strips control characters and collapses whitespace in single-line fields', () => {
    const r = validateFields(form({ location: '  Bengaluru\u0000\r\n  Karnataka ' }), CANDIDATE_RULES);
    expect(r.values.location).toBe('Bengaluru Karnataka');
  });

  it('rejects names with digits or markup', () => {
    expect(validateFields(form({ name: '<b>x</b>' }), CANDIDATE_RULES).errors.name).toBeDefined();
    expect(validateFields(form({ name: 'R2D2' }), CANDIDATE_RULES).errors.name).toBeDefined();
    expect(validateFields(form({ name: "Ra'ees D'Souza-Nair" }), CANDIDATE_RULES).errors.name).toBeUndefined();
  });
});

describe('honeypot', () => {
  it('trips only when filled', () => {
    const f = new FormData();
    expect(isHoneypotTripped(f)).toBe(false);
    f.set('website', '');
    expect(isHoneypotTripped(f)).toBe(false);
    f.set('website', 'http://spam');
    expect(isHoneypotTripped(f)).toBe(true);
  });
});

describe('detectResumeType (magic bytes)', () => {
  it('detects PDF and DOCX', () => {
    expect(detectResumeType(pdfBytes())?.ext).toBe('pdf');
    expect(detectResumeType(docxBytes())?.ext).toBe('docx');
  });

  it('rejects legacy .doc (OLE), other ZIPs, images, executables and text', () => {
    const ole = Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0);
    expect(detectResumeType(ole)).toBeNull();
    expect(detectResumeType(docxBytes(['[Content_Types].xml', 'xl/workbook.xml']))).toBeNull();
    expect(detectResumeType(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBeNull();
    expect(detectResumeType(Uint8Array.of(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
    expect(detectResumeType(new TextEncoder().encode('hello'))).toBeNull();
    expect(detectResumeType(new Uint8Array(0))).toBeNull();
  });

  it('handles a 5 MB DOCX whose central directory is at the end', () => {
    const big = new Uint8Array(5 * 1024 * 1024);
    big.set([0x50, 0x4b, 0x03, 0x04]);
    big.set(new TextEncoder().encode('[Content_Types].xml'), 30);
    big.set(new TextEncoder().encode('word/document.xml'), big.length - 200);
    big.set([0x50, 0x4b, 0x05, 0x06], big.length - 22);
    expect(detectResumeType(big)?.ext).toBe('docx');
  });

  it('extensionOf', () => {
    expect(extensionOf('CV.final.PDF')).toBe('pdf');
    expect(extensionOf('noext')).toBe('');
  });
});

describe('file naming helpers', () => {
  it('fileSafeName', () => {
    expect(fileSafeName('Priya K. Sharma')).toBe('Priya-K-Sharma');
    expect(fileSafeName('José Núñez')).toBe('Jose-Nunez');
    expect(fileSafeName('../../etc')).toBe('etc');
    expect(fileSafeName('தமிழ்')).toBe('candidate');
    expect(fileSafeName('A'.repeat(80))).toHaveLength(40);
  });

  it('istDate uses India time', () => {
    // 2026-03-31 20:00 UTC is already 1 April in India
    expect(istDate(Date.UTC(2026, 2, 31, 20, 0))).toBe('2026-04-01');
  });

  it('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
