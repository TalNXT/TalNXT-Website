/** Bindings and configuration. Plain vars live in wrangler.toml; everything else is a Worker secret. */
export interface Env {
  /** Comma-separated exact origins, e.g. "https://www.talnxt.com,https://talnxt.com". */
  ALLOWED_ORIGINS: string;
  /** "true" skips Microsoft Graph (local testing only). */
  DRY_RUN?: string;

  TURNSTILE_SECRET: string;

  TENANT_ID: string;
  CLIENT_ID: string;
  CLIENT_SECRET: string;

  SHAREPOINT_SITE_ID: string;
  ENQUIRY_LIST_ID: string;
  CANDIDATE_LIST_ID: string;
  RESUME_DRIVE_ID: string;
  /** Optional folder inside the resume library, e.g. "Applications". */
  RESUME_FOLDER_PATH?: string;

  MAIL_FROM: string;
  /** Recruiter inbox; may be a comma-separated list. */
  MAIL_TO: string;

  SUBMIT_LIMITER: RateLimiter;
}

/** Minimal shape of the Workers rate-limiting binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export const isDryRun = (env: Env): boolean => env.DRY_RUN === 'true';
