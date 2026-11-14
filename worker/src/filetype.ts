export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export interface ResumeType {
  ext: 'pdf' | 'docx';
  mime: string;
}

const PDF: ResumeType = { ext: 'pdf', mime: 'application/pdf' };
const DOCX: ResumeType = {
  ext: 'docx',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const PDF_MAGIC = ascii('%PDF-');
const ZIP_LOCAL_HEADER = Uint8Array.of(0x50, 0x4b, 0x03, 0x04);
const ZIP_END_OF_DIR = Uint8Array.of(0x50, 0x4b, 0x05, 0x06);
const DOCX_MAIN_PART = ascii('word/document.xml');
const CONTENT_TYPES = ascii('[Content_Types].xml');

/** Bounded byte search in bytes[from, to). Bounded so CPU time stays tiny on 5 MB files. */
function indexOf(bytes: Uint8Array, needle: Uint8Array, from = 0, to = bytes.length): number {
  const end = Math.min(to, bytes.length) - needle.length;
  outer: for (let i = Math.max(0, from); i <= end; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const SCAN = 64 * 1024;

/**
 * Identify a resume by its content (magic bytes), not by its name or the browser's MIME type.
 * - PDF: "%PDF-" in the first 1 KB (the spec allows a little leading junk).
 * - DOCX: a ZIP (local header at 0, end-of-central-directory record near the end) whose
 *   file names include "[Content_Types].xml" and "word/document.xml". Names are stored
 *   uncompressed in the local headers (start) and in the central directory (end), so only
 *   the first and last 64 KB need scanning.
 * Legacy .doc (OLE), images, executables, and other ZIPs (xlsx, pptx, plain zips) are rejected.
 */
export function detectResumeType(bytes: Uint8Array): ResumeType | null {
  if (indexOf(bytes, PDF_MAGIC, 0, 1024) !== -1) return PDF;

  if (indexOf(bytes, ZIP_LOCAL_HEADER, 0, 4) === 0) {
    const tailStart = Math.max(0, bytes.length - SCAN);
    if (indexOf(bytes, ZIP_END_OF_DIR, tailStart) === -1) return null;
    const has = (needle: Uint8Array) =>
      indexOf(bytes, needle, 0, SCAN) !== -1 || indexOf(bytes, needle, tailStart) !== -1;
    if (has(CONTENT_TYPES) && has(DOCX_MAIN_PART)) return DOCX;
  }
  return null;
}

export function extensionOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName);
  return m?.[1] ? m[1].toLowerCase() : '';
}
