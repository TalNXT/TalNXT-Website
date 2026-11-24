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

  /** "Bench Profiles" list for the Talent Bench page (optional; GET /api/bench returns 503 until set). */
  BENCH_LIST_ID?: string;
  /** Long random key for /api/bench?refresh=<key> (falls back to LINKEDIN_SETUP_KEY). */
  BENCH_REFRESH_KEY?: string;

  MAIL_FROM: string;
  /** Recruiter inbox; may be a comma-separated list. */
  MAIL_TO: string;

  SUBMIT_LIMITER: RateLimiter;

  /* LinkedIn feed (optional; the feature stays off until all of these are set). See docs/SETUP.md. */
  /** KV namespace holding the LinkedIn token and the last synced feed. */
  LINKEDIN_KV?: KVNamespace;
  /** LinkedIn app Client ID (public, in wrangler.toml). */
  LINKEDIN_CLIENT_ID?: string;
  /** Numeric ID of the TalNXT company page (public, in wrangler.toml). */
  LINKEDIN_ORG_ID?: string;
  /** LinkedIn API version header, YYYYMM (in wrangler.toml). */
  LINKEDIN_API_VERSION?: string;
  /** LinkedIn app Client Secret (Worker secret). */
  LINKEDIN_CLIENT_SECRET?: string;
  /** Long random key that protects the connect and manual-sync links (Worker secret). */
  LINKEDIN_SETUP_KEY?: string;
}

/** Minimal shape of the Workers rate-limiting binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export const isDryRun = (env: Env): boolean => env.DRY_RUN === 'true';
