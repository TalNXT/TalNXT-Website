/** An error that is safe to show to the visitor. `message` is user-facing; `code` is for the frontend. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly fields?: Record<string, string>,
  ) {
    super(code);
  }
}

export function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

/**
 * Structured log line. Callers pass only non-personal details (stage, status codes,
 * error codes, the random submission id). Never pass form values here.
 */
export function logEvent(level: 'info' | 'warn' | 'error', event: string, details: Record<string, string | number | boolean | undefined> = {}): void {
  const line = JSON.stringify({ level, event, ...details });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const GENERIC_ERROR =
  'Sorry, something went wrong on our side. Please try again in a few minutes, or email us at info@talnxt.com.';
