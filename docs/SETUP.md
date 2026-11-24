# Website forms backend: setup guide

This guide connects the website's **enquiry form** (home, Contingent Staffing and People & HR pages, plus the TalNXT Digital contact form, see section 11) and **job application form** (Careers page, plus the "Submit Your Resume" buttons) to Microsoft 365. It runs on free tiers only.

```
Browser (www.talnxt.com, GitHub Pages)
  │  multipart POST + Turnstile token
  ▼
Cloudflare Worker "talnxt-forms" (free plan)      worker/
  │  checks: origin, rate limit, honeypot, validation, file type, Turnstile
  │  Microsoft Graph, app-only auth
  ├─► SharePoint library "Candidate Resumes"     (resume files)
  ├─► SharePoint list "Website Enquiries" / "Candidate Applications"
  └─► Exchange: notification to the recruiter inbox + acknowledgement to the sender
```

Until you finish **Step 4.5** (adding the Worker URL and Turnstile site key to `js/forms.js`), the forms keep their old behaviour and open a pre-filled email. You can deploy the website changes safely before the backend is ready.

**What you need**

- Node.js 20 or later (`node -v`)
- A Microsoft 365 admin account that can register apps in Entra ID, manage SharePoint and run Exchange Online PowerShell (a Global Administrator can do all of it)
- An email address for a new Cloudflare account
- About 60–90 minutes

Values in `<angle brackets>` are placeholders. Keep a private note (not in this repo) of each value as you collect it. You'll need **11 values** for Step 4:

| Secret name | Where it comes from |
|---|---|
| `TENANT_ID` | Step 2.1 |
| `CLIENT_ID` | Step 2.1 |
| `CLIENT_SECRET` | Step 2.2 |
| `SHAREPOINT_SITE_ID` | Step 1.4 |
| `ENQUIRY_LIST_ID`, `CANDIDATE_LIST_ID` | Step 1.4 |
| `RESUME_DRIVE_ID` | Step 1.4 |
| `RESUME_FOLDER_PATH` | Optional, Step 1.3 |
| `MAIL_FROM` | Step 3.1 |
| `MAIL_TO` | The recruiter inbox (comma-separate several) |
| `TURNSTILE_SECRET` | Step 4.2 |

The optional LinkedIn feed adds two more secrets, `LINKEDIN_CLIENT_SECRET` and `LINKEDIN_SETUP_KEY`, covered in section 10. The Talent Bench page adds `BENCH_LIST_ID` (and optionally `BENCH_REFRESH_KEY`), covered in section 12.

---

## 1. SharePoint: site, library and lists

### 1.1 Choose or create the site

Use a dedicated site that only the recruitment team can open, for example `https://<tenant>.sharepoint.com/sites/Recruitment`.
To create one: **SharePoint admin center → Sites → Active sites → Create → Team site (no Microsoft 365 group)** or **Communication site**. Make only recruiters members.

The app will get access to **this one site only** (Step 2.4), so don't use a site that holds unrelated data.

### 1.2 Open Graph Explorer as an admin

1. Go to <https://developer.microsoft.com/graph/graph-explorer> and **sign in** with your admin account.
2. Click your profile picture → **Consent to permissions**. Search for and consent to **Sites.FullControl.All**.
   This is a *delegated* permission for you in Graph Explorer, not for the website app. It's needed to create the lists and to grant the app access to the site. You can revoke it later under **Microsoft Entra admin center → Enterprise applications → Graph Explorer → Permissions**.

### 1.3 Create the library and the two lists

The Worker writes to these **exact column names**. Creating them through Graph (below) guarantees the internal names match. If you create columns by hand in SharePoint, type each name **exactly as shown, with no spaces**, and never rename them later (SharePoint keeps the original internal name).

First get the site ID. Run a **GET**:

```
https://graph.microsoft.com/v1.0/sites/<tenant>.sharepoint.com:/sites/Recruitment?$select=id,webUrl
```

Copy `id`. It looks like `<tenant>.sharepoint.com,1111…,2222…`. This is **`SHAREPOINT_SITE_ID`**. Use it in place of `{site-id}` below.

**a) Resume library.** Run a **POST** to `https://graph.microsoft.com/v1.0/sites/{site-id}/lists` with this request body:

```json
{ "displayName": "Candidate Resumes", "list": { "template": "documentLibrary" } }
```

**b) Enquiries list.** Run a **POST** to the same URL with:

```json
{
  "displayName": "Website Enquiries",
  "list": { "template": "genericList" },
  "columns": [
    { "name": "SubmissionId", "text": {} },
    { "name": "EnquiryType", "text": {} },
    { "name": "FullName", "text": {} },
    { "name": "Company", "text": {} },
    { "name": "Email", "text": {} },
    { "name": "Phone", "text": {} },
    { "name": "Roles", "text": { "allowMultipleLines": true } },
    { "name": "Positions", "number": {} },
    { "name": "EngagementModel", "text": {} },
    { "name": "WorkLocation", "text": {} },
    { "name": "NeededBy", "text": {} },
    { "name": "HrArea", "text": {} },
    { "name": "CompanySize", "text": {} },
    { "name": "Timeline", "text": {} },
    { "name": "Message", "text": { "allowMultipleLines": true } },
    { "name": "SourcePage", "text": {} },
    { "name": "ConsentGiven", "boolean": {} }
  ]
}
```

The built-in **Title** column holds the company name.

**c) Candidates list.** Run a **POST** to the same URL with:

```json
{
  "displayName": "Candidate Applications",
  "list": { "template": "genericList" },
  "columns": [
    { "name": "SubmissionId", "text": {} },
    { "name": "Email", "text": {} },
    { "name": "Phone", "text": {} },
    { "name": "Role", "text": {} },
    { "name": "CurrentLocation", "text": {} },
    { "name": "ExperienceYears", "number": { "decimalPlaces": "one" } },
    { "name": "NoticePeriod", "text": {} },
    { "name": "LinkedInUrl", "text": {} },
    { "name": "Message", "text": { "allowMultipleLines": true } },
    { "name": "ResumeUrl", "text": { "allowMultipleLines": true } },
    { "name": "ResumeFileName", "text": {} },
    { "name": "SourcePage", "text": {} },
    { "name": "ConsentGiven", "boolean": {} }
  ]
}
```

The built-in **Title** column holds the candidate's name. The SharePoint **Created** column records the submission time.

**Optional subfolder:** to store resumes in a folder such as `Applications` inside the library, set `RESUME_FOLDER_PATH=Applications`. The folder is created automatically on the first upload. Leave it empty to use the library root.

**Tip:** in SharePoint, open each list → **Settings → List settings → Permissions for this list** if you want even tighter access than the site's. In each list's default view, show the columns your team uses most (for example Title, Role, Email, Phone and Created).

### 1.4 Collect the IDs

Run **GET** `https://graph.microsoft.com/v1.0/sites/{site-id}/lists?$select=id,displayName`

- `id` of **Website Enquiries** → **`ENQUIRY_LIST_ID`**
- `id` of **Candidate Applications** → **`CANDIDATE_LIST_ID`**

Run **GET** `https://graph.microsoft.com/v1.0/sites/{site-id}/drives?$select=id,name`

- `id` of **Candidate Resumes** (starts with `b!`) → **`RESUME_DRIVE_ID`**

---

## 2. Microsoft Entra: app registration (least privilege)

### 2.1 Register the app

**Microsoft Entra admin center → Identity → Applications → App registrations → New registration**

- Name: `TalNXT Website Forms`
- Supported account types: **Accounts in this organizational directory only**
- Redirect URI: leave empty → **Register**

From the **Overview** page, copy **Directory (tenant) ID** → **`TENANT_ID`** and **Application (client) ID** → **`CLIENT_ID`**.

### 2.2 Create a client secret

**Certificates & secrets → Client secrets → New client secret.** Use the description `cloudflare-worker`, and choose an expiry of up to 24 months.
Copy the **Value** (not the "Secret ID") immediately. It is shown only once. This is **`CLIENT_SECRET`**.

> Put a calendar reminder two weeks before the expiry date. When it expires the forms stop saving. To rotate, create a new secret, run `npx wrangler secret put CLIENT_SECRET`, then delete the old one.

### 2.3 Add only Sites.Selected

**API permissions → Add a permission → Microsoft Graph → Application permissions → Sites.Selected → Add.**
Then click **Grant admin consent for <your organisation>**.

- Remove the default delegated **User.Read** if it's listed. The app doesn't need it.
- **Don't add Mail.Send here** if you follow Step 3 Option A (recommended). An Entra Mail.Send grant would let the app send as *every* mailbox, and Exchange RBAC grants are added on top of it, not instead of it.

The app's final Entra permission list should show **only `Sites.Selected` (Application), with admin consent granted**.

### 2.4 Give the app write access to the one site

On its own, Sites.Selected grants nothing. You grant the app access to each site explicitly. In Graph Explorer (still signed in as admin, from Step 1.2), run a **POST** to `https://graph.microsoft.com/v1.0/sites/{site-id}/permissions` with:

```json
{
  "roles": ["write"],
  "grantedToIdentities": [
    { "application": { "id": "<CLIENT_ID>", "displayName": "TalNXT Website Forms" } }
  ]
}
```

To check it, run **GET** on the same URL. The app should be listed with role `write`.
`write` lets the app add files and list items on this site only. It can't create lists, change permissions or reach any other site.

---

## 3. Exchange Online: sending mailbox and Mail.Send restricted to it

### 3.1 Create a shared mailbox (free, no licence)

**Exchange admin center → Recipients → Mailboxes → Add a shared mailbox**, for example `enquiries@talnxt.com` with display name **TalNXT Enquiries** (recipients see this as the sender name). This is **`MAIL_FROM`**. Notifications and acknowledgements are sent from it, and replies from candidates and clients land in it, so give the recruiters access.

> Shared mailboxes need no licence up to 50 GB. Don't convert it to a user mailbox, because that would need a paid licence.

### 3.2 Option A (recommended): RBAC for Applications

Run these in **Windows PowerShell** as an Exchange administrator:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # first time only
Connect-ExchangeOnline

# 0) Newer tenants only: if the next command says "isn't currently allowed in your organization",
#    run this once, then retry after a few minutes (it can take up to about an hour).
Enable-OrganizationCustomization

# 1) A scope that contains ONLY the sending mailbox
New-ManagementScope -Name "TalNXT Forms Sender" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'enquiries@talnxt.com'"

# 2) Register the app's service principal in Exchange.
#    ObjectId = Entra admin center -> Enterprise applications -> "TalNXT Website Forms" -> Object ID
#    (the ENTERPRISE APPLICATION's object ID, not the one on the App registration page)
New-ServicePrincipal -AppId <CLIENT_ID> -ObjectId <ENTERPRISE_APP_OBJECT_ID> -DisplayName "TalNXT Website Forms"

# 3) Allow Mail.Send only inside that scope
New-ManagementRoleAssignment -App <CLIENT_ID> -Role "Application Mail.Send" -CustomResourceScope "TalNXT Forms Sender"

# 4) Check: the first should show InScope = True, the second False
Test-ServicePrincipalAuthorization -Identity <CLIENT_ID> -Resource enquiries@talnxt.com
Test-ServicePrincipalAuthorization -Identity <CLIENT_ID> -Resource <any-other-user>@talnxt.com
```

Changes can take **30 minutes to 2 hours** to take effect.

### 3.3 Option B (legacy): Application Access Policy

Microsoft is replacing Application Access Policies with RBAC for Applications, so use this only if Option A isn't available to you.

1. In Entra, **add Mail.Send (Application)** to the app and grant admin consent.
2. Restrict it:

```powershell
Connect-ExchangeOnline
New-DistributionGroup -Name "TalNXT Forms Senders" -Type Security -Members enquiries@talnxt.com
New-ApplicationAccessPolicy -AppId <CLIENT_ID> -PolicyScopeGroupId "TalNXT Forms Senders" `
  -AccessRight RestrictAccess -Description "Website forms may send only as the enquiries mailbox"
Test-ApplicationAccessPolicy -Identity enquiries@talnxt.com -AppId <CLIENT_ID>         # Granted
Test-ApplicationAccessPolicy -Identity <other-user>@talnxt.com -AppId <CLIENT_ID>    # Denied
```

**Don't use both options.**

### 3.4 Email deliverability

Acknowledgements go to outside addresses. Make sure your domain's **SPF, DKIM and DMARC** are set up (**Microsoft Defender portal → Email & collaboration → Policies → DKIM**), or they may land in spam.

---

## 4. Cloudflare: account, Turnstile and Worker

### 4.1 Create the account

Sign up at <https://dash.cloudflare.com/sign-up>. The **Free** plan is all you need. **Don't add a payment method** unless you decide to upgrade later: without one, nothing can be charged.
You don't need to move the `talnxt.com` DNS to Cloudflare. The Worker runs on a free `*.workers.dev` address.

### 4.2 Create the Turnstile widget

**Dashboard → Turnstile → Add widget**

- Widget name: `TalNXT website forms`
- Hostnames: `www.talnxt.com` and `talnxt.com`
- Widget mode: **Managed**
- Pre-clearance: **No**

Copy the **Site Key** (public, goes in `js/forms.js`) and the **Secret Key** → **`TURNSTILE_SECRET`**.

### 4.3 Deploy the Worker

```bash
cd worker
npm ci                    # installs the pinned dev tools from package-lock.json
npm run check             # type check + tests + build check, all must pass
npx wrangler login        # opens the browser to authorise Wrangler
npx wrangler deploy       # first time: choose a workers.dev subdomain when asked
```

The output prints the URL, for example `https://talnxt-forms.<your-subdomain>.workers.dev`.

### 4.4 Set the secrets

Each command prompts for the value. Paste it and press Enter. The values are encrypted in Cloudflare and never written to the repo.

```bash
npx wrangler secret put TENANT_ID
npx wrangler secret put CLIENT_ID
npx wrangler secret put CLIENT_SECRET
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put SHAREPOINT_SITE_ID
npx wrangler secret put ENQUIRY_LIST_ID
npx wrangler secret put CANDIDATE_LIST_ID
npx wrangler secret put RESUME_DRIVE_ID
npx wrangler secret put RESUME_FOLDER_PATH     # optional; skip it to use the library root
npx wrangler secret put MAIL_FROM
npx wrangler secret put MAIL_TO
npx wrangler secret list                       # names only, never values
```

`ALLOWED_ORIGINS` and `DRY_RUN` are ordinary settings in `worker/wrangler.toml` (they aren't secret). Keep `DRY_RUN = "false"` in production.

Check the Worker is up:

```bash
curl https://talnxt-forms.<your-subdomain>.workers.dev/api/health
# {"ok":true}
```

### 4.5 Point the website at the Worker

Edit `js/forms.js`:

```js
window.TALNXT_FORMS_CONFIG = window.TALNXT_FORMS_CONFIG || {
  apiBase: 'https://talnxt-forms.<your-subdomain>.workers.dev',
  turnstileSiteKey: '<TURNSTILE_SITE_KEY>'
};
```

Commit and push to `main`. GitHub Pages redeploys automatically.

### 4.6 Test in production

1. On <https://www.talnxt.com>, click **Build Your Team With Us** and submit a test enquiry using your own email.
2. On **Careers**, click **Apply Now** and send a small PDF.
3. Check: the list items appear in SharePoint, the resume is in **Candidate Resumes** (named `YYYY-MM-DD_Name_<id>.pdf`), the recruiter received a notification, and you received an acknowledgement.
4. Delete the test items and file.

---

## 5. Local development and testing

### Automated tests (no accounts or network needed)

```bash
cd worker
npm test            # 61 tests: validation, phone/email rules, magic-byte checks, CORS,
                    # rate limit, honeypot, Turnstile, Graph calls (mocked), no personal data in logs
npm run typecheck
npm run check       # both of the above + a wrangler build dry run
```

### Run the Worker locally

```bash
cd worker
cp .dev.vars.example .dev.vars     # .dev.vars is gitignored; never commit it
npx wrangler dev                   # http://localhost:8787
```

`.dev.vars.example` uses `DRY_RUN=true`, which skips Microsoft entirely, and Cloudflare's **test** Turnstile secret, which always passes. To test end to end against your tenant, put real values in `.dev.vars` and set `DRY_RUN=false`.

Serve the website on port 8080 in a second terminal (from the repo root):

```bash
npx --yes http-server . -p 8080 -c-1
```

Then **temporarily** set `js/forms.js` to `apiBase: 'http://localhost:8787'` and the test site key `turnstileSiteKey: '1x00000000000000000000AA'`. Open <http://localhost:8080>. **Don't commit these test values.**

Quick check with curl (Git Bash; create a small PDF first):

```bash
printf '%%PDF-1.7\n%%%%EOF\n' > test.pdf
curl -H "Origin: http://localhost:8080" \
  -F role="General application" -F name="Test User" -F email=test@example.com \
  -F phone="98765 43210" -F consent=on -F "resume=@test.pdf;type=application/pdf" \
  -F cf-turnstile-response=XXXX.DUMMY.TOKEN.XXXX \
  http://localhost:8787/api/candidate
# {"ok":true,"id":"..."}
```

Logs: `npx wrangler tail` streams production logs, and **Workers & Pages → talnxt-forms → Logs** shows them in the dashboard. Only the event name, the stage, HTTP and Graph error codes and the random submission ID are logged. Names, emails, phones and messages are never logged.

---

## 6. Day-to-day changes

| Change | Where |
|---|---|
| Recruiter inbox(es) | `npx wrangler secret put MAIL_TO` (comma-separate several) |
| Allowed website addresses | `ALLOWED_ORIGINS` in `worker/wrangler.toml`, then `npx wrangler deploy` |
| Rate limit (default 5 per IP per minute per form) | `[[ratelimits]]` in `worker/wrangler.toml` (`period` must be 10 or 60) |
| A dropdown option in a form | Change it in the HTML **and** in `OPTIONS` in `worker/src/validate.ts`, then redeploy, or the server rejects the new value |
| Field length limits | `worker/src/validate.ts` (keep the HTML `maxlength` attributes in step) |
| Saved (fallback) LinkedIn posts on the Thought Leadership page | `data/linkedin-posts.json` (instructions inside the file). Live posts are synced automatically; see section 10 |
| Privacy policy text | `privacy.html` |

---

## 7. Cost and limits (₹0/month at 10–100 submissions)

| Service | Free allowance | What happens at the limit |
|---|---|---|
| Cloudflare Workers Free | 100,000 requests/day, 10 ms CPU per request | Requests fail. **No charge** without a paid plan |
| Workers rate-limiting binding | Included | — |
| Workers Logs | Included daily quota on the free plan | Extra logs are dropped |
| Workers KV (LinkedIn feed) | 100,000 reads and 1,000 writes/day | The feed uses a handful of writes a day; at the limit writes fail and the site shows the saved posts |
| Cron triggers (LinkedIn sync) | Included | — |
| LinkedIn API (Community Management API, Development tier) | Free | Calls are rejected; the site shows the saved posts |
| Turnstile | Free | — |
| Microsoft Graph (Sites, sendMail) | No per-call charge | Throttling (the Worker retries once) |
| SharePoint storage | Counts against your tenant's quota | ~5 MB per resume is negligible |
| Shared mailbox | Free up to 50 GB | — |

**Things that *could* cost money (avoid unless intended):**

- Upgrading to **Workers Paid** (US$5/month). It isn't needed at this volume.
- Converting the shared mailbox into a licensed user mailbox, or using a licensed user as `MAIL_FROM`.
- Adding Cloudflare products outside the free plan (for example paid KV/R2 usage or Advanced Rate Limiting). This project uses none.

**CPU time:** the free plan allows 10 ms of CPU per request. Waiting on Microsoft and Turnstile doesn't count. Parsing a 5 MB upload and checking its file type takes a few milliseconds, and the type check reads only the first and last 64 KB. If **Logs** ever show "Exceeded CPU limit" on `/api/candidate`, lower the resume limit (`MAX_RESUME_BYTES` in `worker/src/filetype.ts` and `MAX_BYTES` in `js/careers.js`).

---

## 8. Security summary

- **Entra:** only `Sites.Selected` (application), with `write` on one site. Mail.Send comes from Exchange RBAC, scoped to one mailbox.
- **Worker:** exact-origin CORS and an origin check, Turnstile on every submission, a hidden honeypot field, a per-IP rate limit, strict server-side validation, resume type checked by **magic bytes** (PDF or DOCX only, 5 MB max), HTML-escaped emails, and fixed-text acknowledgements so the form can't be used to send arbitrary content.
- **LinkedIn:** read-only scope `r_organization_social`, our own company page only. The connect and manual-sync links need `LINKEDIN_SETUP_KEY`; the sign-in uses a one-time `state`. The token lives only in Workers KV and is never logged or returned.
- **Errors:** visitors see friendly messages only. Microsoft error details stay in the logs (codes only).
- **Secrets:** stored only in Cloudflare (`wrangler secret`) and your local `.dev.vars`, both excluded by `.gitignore`.
- **Public repo:** GitHub Pages publishes the whole repo, including `worker/` and `docs/`. They contain no secrets, so this is safe, but you can exclude them from the Pages upload if you prefer.

---

## 9. Troubleshooting

Start with `npx wrangler tail` (or **Workers & Pages → talnxt-forms → Logs**) and submit the form again. A `graph_failed` line tells you the **stage**, HTTP **status** and Graph **code**.

| Symptom / log | Likely cause and fix |
|---|---|
| Form still opens an email app | `apiBase` or `turnstileSiteKey` in `js/forms.js` is empty, or the site hasn't redeployed yet. Hard-refresh the page (Ctrl+F5) |
| "This form can only be submitted from the TalNXT website" (403 `forbidden_origin`) | The page's address isn't in `ALLOWED_ORIGINS`. It must match exactly: `https`, with or without `www`, and no trailing slash |
| Browser console shows a CORS error with no JSON | Wrong Worker URL in `forms.js`, or the Worker isn't deployed. Check `/api/health` |
| "Please wait a moment while we complete a quick security check" won't go away | Turnstile isn't loading. An ad blocker may be blocking `challenges.cloudflare.com`, or the site key is wrong. Check the browser Network tab |
| "The security check expired or failed" (403 `verification_failed`) | The site's hostname isn't in the widget's hostnames, the site key and secret are from different widgets, or the test secret is still set in production |
| 429 "several submissions in a short time" | Rate limit hit. Wait a minute, or raise `limit` in `wrangler.toml` |
| `stage: token`, status 400/401, `invalid_client` | Wrong or expired `CLIENT_SECRET` (use the secret **Value**, not its ID), or wrong `TENANT_ID`/`CLIENT_ID` |
| `stage: upload_resume` or `*_list_item`, 403 `accessDenied` | Admin consent for Sites.Selected is missing (Step 2.3), or the site grant wasn't made (Step 2.4), or it was made on a different site |
| … 404 `itemNotFound` | Wrong `SHAREPOINT_SITE_ID`, list ID or `RESUME_DRIVE_ID` (Step 1.4). Secrets have no stray spaces |
| `*_list_item`, 400 `invalidRequest` (field not recognised) | A column's internal name doesn't match. Recreate it with the exact name from Step 1.3 (columns created with spaces get names like `Full_x0020_Name`) |
| `*_notification` or `*_ack`, 403 `ErrorAccessDenied` | `MAIL_FROM` isn't in the RBAC scope or access policy, or the change is still taking effect (wait up to 2 hours). Re-run `Test-ServicePrincipalAuthorization` |
| `*_notification`, 404 `ResourceNotFound` / `MailboxNotEnabledForRESTAPI` | `MAIL_FROM` isn't a real mailbox (for example it's a group or alias) |
| Saved in the list but no recruiter email (or the reverse) | By design, the visitor still sees success if **either** the list item or the email worked. The log shows which part failed |
| Visitor got no acknowledgement | Check spam. A log line `ack_failed` shows the reason. Set up SPF/DKIM/DMARC (Step 3.4) |
| "Please choose a valid option for …" | A dropdown option in the HTML no longer matches `OPTIONS` in `worker/src/validate.ts` |
| "Please upload your resume as a PDF or Word (.docx) file" for a real resume | The file is a legacy `.doc`, a renamed file, or a "PDF" that is really an image. Ask the candidate to save it as PDF or DOCX |
| `wrangler dev` fails with `spawn UNKNOWN`, or Windows reports "An Application Control policy has blocked this file" | Windows Smart App Control or WDAC is blocking the local runtime (`workerd.exe`). This happens on Windows on ARM, which has no native `workerd` build, and on locked-down PCs. Options: run `npm test`, which needs no runtime; use **WSL2** (Ubuntu) and run the same commands there; or `npx wrangler dev --remote`, which runs on Cloudflare. Don't weaken the device policy just for this |
| `npm install` warns about install scripts for `esbuild` / `workerd` | npm 11 asks before running them. They're already approved in `worker/package.json` (`allowScripts`). If versions change, run `npm install-scripts approve esbuild workerd` |
| Thought Leadership page shows "New perspectives are on their way" | `data/linkedin-posts.json` isn't valid JSON and there is no live feed. Paste the file into a JSON validator. For the live feed, see section 10.7 |

---

## 10. LinkedIn feed (Thought Leadership page)

The Thought Leadership page shows **live** posts from the TalNXT LinkedIn page when the sync is working, and the **saved** posts in `data/linkedin-posts.json` whenever it isn't (before setup, if the LinkedIn token expires, or if LinkedIn or the Worker is down or slow). Visitors always see posts; nothing breaks.

```
every 6 hours (cron)  ->  Worker reads our page's posts via LinkedIn's official API  ->  saves the last good copy in Workers KV
visitor opens page    ->  GET /api/linkedin-posts (live, if synced within 7 days)    ->  else data/linkedin-posts.json
```

Only LinkedIn's official **Community Management API** is used, with the read-only scope `r_organization_social`. No scraping.

### 10.1 LinkedIn app (one time)

1. At **linkedin.com/developers**, as a **super admin** of the TalNXT company page: **Create app** (name `TalNXT Website`, LinkedIn Page = TalNXT, privacy policy `https://www.talnxt.com/privacy.html`).
2. **Settings** → verify the app with the company page.
3. **Products** → **Community Management API** → **Access request form**. Use case: *Direct Advertiser*; other use cases: *Page management* only. Describe it as read-only display of our own page's posts on our website.
4. **Auth** → **Authorized redirect URLs**: `https://talnxt-forms.talnxt.workers.dev/api/linkedin/callback`
5. Wait for approval. You'll know it's approved when **Auth → OAuth 2.0 scopes** lists `r_organization_social`.

### 10.2 Configure the Worker (after approval)

1. **Company page ID:** open the TalNXT page as an admin; the address looks like `linkedin.com/company/12345678/admin/`. Put the number in `LINKEDIN_ORG_ID` in `worker/wrangler.toml`. (`LINKEDIN_CLIENT_ID` is already set.)
2. Secrets (paste each value when asked; never put them in a file or chat):
   ```bash
   cd worker
   npx wrangler secret put LINKEDIN_CLIENT_SECRET   # LinkedIn app -> Auth -> Primary Client Secret
   npx wrangler secret put LINKEDIN_SETUP_KEY       # any long random string (20+ characters); keep it in a password manager
   ```
   A quick way to make a setup key in PowerShell: `-join ((48..57)+(97..122) | Get-Random -Count 32 | % {[char]$_})`
3. `npx wrangler deploy`

### 10.3 Connect (a page super admin, 2 minutes)

1. Open `https://talnxt-forms.talnxt.workers.dev/api/linkedin/connect?key=YOUR-SETUP-KEY`
2. Sign in to LinkedIn and click **Allow**.
3. You land on a page saying **"LinkedIn connected. The website now shows N live posts"**. Open the Thought Leadership page to check.

To sync immediately at any time (for example right after publishing a post): `https://talnxt-forms.talnxt.workers.dev/api/linkedin/sync?key=YOUR-SETUP-KEY`. Otherwise the cron picks it up within 6 hours, and visitors' browsers may cache the feed for up to 5 minutes.

### 10.4 Token expiry

LinkedIn access tokens last about **60 days**. If LinkedIn issues a refresh token to the app, the Worker renews it automatically. If not, from 10 days before expiry the Worker emails `MAIL_TO` (from `MAIL_FROM`) every 3 days until someone repeats **10.3**. While the token is expired, the site shows the saved posts.

### 10.5 How cards are built from posts

- **Title:** the post's first paragraph (or its first sentence if the paragraph is long). **Excerpt:** the next paragraph. **Read more:** the rest.
- **Topic tag:** the post's first hashtag, split into words (`#BusinessStrategy` → "Business Strategy"), or "Insights" if there is none.
- Hashtag-only lines, bare links and sign-offs such as "🌐 www.talnxt.com" or "Follow our page…" are left out. Only **published, public** posts with text are shown, newest first (up to 24).
- Images and document carousels aren't shown on the cards; **View post** opens the full post on LinkedIn.

### 10.6 Keeping the saved posts useful

The saved posts are the fallback, so refresh `data/linkedin-posts.json` now and then with your best recent posts (same format, instructions inside the file). They are also what the page shows until the LinkedIn app is approved.

### 10.7 Troubleshooting

Check **Cloudflare dashboard → Workers → talnxt-forms → Logs** for `linkedin_sync`:

| `status` in the log | Meaning and fix |
|---|---|
| `not_configured` | `LINKEDIN_ORG_ID`, `LINKEDIN_CLIENT_ID` or `LINKEDIN_CLIENT_SECRET` missing. See 10.2 |
| `not_connected` | Nobody has done 10.3 yet |
| `token_expired` | Repeat 10.3 |
| `api_error`, `httpStatus` 401 | Token revoked or wrong app. Repeat 10.3 |
| `api_error`, `httpStatus` 403 | The app lacks `r_organization_social`, or the person who connected isn't a super admin of the page |
| `api_error`, `httpStatus` 426 or code `NONEXISTENT_VERSION` | `LINKEDIN_API_VERSION` in `wrangler.toml` is retired. Set a recent month (`YYYYMM`) and deploy |
| `no_posts` | The page has no public posts with text. The previous feed is kept |
| `ok` | Working. `count` is the number of posts synced |

The connect page says **"Link expired"**: the sign-in took more than 10 minutes or the link was reused. Open the connect link again.

---

## 11. TalNXT Digital contact form (talnxtdigital.com)

The **Get in touch** form on the TalNXT Digital site (`contact.html` in the `TalNXT-Digital` repo) uses this same Worker, Entra app, SharePoint site and mailboxes. Nothing new is created in Microsoft 365 apart from two list columns.

```
talnxtdigital.com/contact.html  --POST /api/digital-enquiry + Turnstile token-->  talnxt-forms Worker
  ├─► SharePoint list "Website Enquiries"   (EnquiryType = "Digital")
  └─► Exchange: notification from MAIL_FROM (enquiries@talnxt.com) to MAIL_TO, and a TalNXT Digital-branded acknowledgement to the sender
```

| Form field | List column | Notes |
|---|---|---|
| Company (or the name, if company is blank) | `Title` | |
| Your name, Work email, Company | `FullName`, `Email`, `Company` | No phone is asked on this form |
| Cloud platform | `CloudPlatform` | **New column**. "Not sure yet" is left blank |
| I'm interested in | `ServiceInterest` | **New column**. "Not sure yet" is left blank |
| Tell us more | `Message` | |
| (automatic) | `EnquiryType` = `Digital`, `SourcePage` = `talnxtdigital.com/contact.html`, `ConsentGiven` = Yes | |

### 11.1 Add the two columns (one time)

In Graph Explorer (signed in as admin, Step 1.2), run a **POST** to `https://graph.microsoft.com/v1.0/sites/{site-id}/lists/{ENQUIRY_LIST_ID}/columns` **twice**, once with each body:

```json
{ "name": "CloudPlatform", "text": {} }
```

```json
{ "name": "ServiceInterest", "text": {} }
```

Until these exist, Digital enquiries still reach the inbox by email, but the list item fails (`digital_enquiry_list_item`, 400 `invalidRequest` in the logs). Tip: add a view on the list filtered to `EnquiryType = Digital`.

### 11.2 Allow the Digital site

1. **Turnstile:** Cloudflare dashboard → **Turnstile** → widget **TalNXT website forms** → **Settings** → add hostnames `talnxtdigital.com`, `www.talnxtdigital.com` and `talnxt.github.io` → Save. (The Digital site uses the same public site key.) Without this, the form shows "The security check expired or failed".
2. **Origins:** `ALLOWED_ORIGINS` in `worker/wrangler.toml` already lists `https://talnxtdigital.com`, `https://www.talnxtdigital.com` and `https://talnxt.github.io` (the GitHub Pages address, used until the custom domain is live). Remove `talnxt.github.io` once the Digital site is only served from its own domain.
3. Deploy the Worker: `cd worker && npx wrangler deploy`.

The Digital site's `js/config.js` holds `formsApi` and `turnstileSiteKey`. If either is emptied, its form falls back to opening a pre-filled email.

### 11.3 Test

On the Digital site's **Contact** page, submit a test with your own email. Check: a `Digital` item in **Website Enquiries**, a "New TalNXT Digital enquiry: …" email in the `MAIL_TO` inbox (sent from enquiries@talnxt.com, Reply goes to the visitor), and a "We have received your enquiry - TalNXT Digital" acknowledgement. Delete the test item.

### 11.4 Changing the dropdowns

The **Cloud platform** and **I'm interested in** options must match `OPTIONS.cloudPlatform` and `OPTIONS.digitalInterest` in `worker/src/validate.ts` exactly. Change both, then redeploy the Worker.

---

## 12. Talent Bench (talent-bench.html)

The **Talent Bench** page lists anonymised bench profiles that the team keeps in a SharePoint list. Visitors filter by vertical, technology, experience, availability, work mode, location and budget, shortlist profiles, and send one **Request profiles** enquiry. That enquiry goes through the existing `/api/enquiry` route into **Website Enquiries**, with the profile IDs in a new `RequestedProfiles` column.

```
SharePoint list "Bench Profiles"  ◄── recruiters add/edit items with the SharePoint form
  │  Graph GET (Sites.Selected, the same app and site grant as the forms)
  ▼
talnxt-forms Worker  GET /api/bench
  │  only items with "Show on website" = Yes, only whitelisted columns
  │  cached 10 min (memory + KV key bench:snapshot); last good copy served if Graph fails
  ▼
www.talnxt.com/talent-bench.html  (filters run in the browser; ?tech=reactjs&vertical=engineering links are shareable)
  │  "Request profiles"
  ▼
POST /api/enquiry (staffing, profiles=TNB-1003, TNB-1015)  ─►  Website Enquiries + recruiter email
```

**Nothing new in Entra or Exchange.** The app's existing `write` grant on the Recruitment site (Step 2.4) also allows reading, and the list lives on that same site.

**What must never go in the list:** candidate names, employer or client names, email, phone, LinkedIn URLs or photos. The Worker only ever reads the columns in the table below, so **Internal Notes** is never sent to the website, but every other column is public.

### 12.1 Create the "Bench Profiles" list (Graph Explorer, about 5 minutes)

Create the list through Graph, as in Step 1.3, so the **internal column names match what the Worker reads**. (Creating columns by hand with names like "Experience (yrs)" produces internal names such as `Experience_x0020__x0028_yrs_x0029_`, which the Worker cannot find.) You can rename the *display* names freely afterwards.

In Graph Explorer (signed in as admin, Step 1.2), run a **POST** to `https://graph.microsoft.com/v1.0/sites/{site-id}/lists` with:

```json
{
  "displayName": "Bench Profiles",
  "list": { "template": "genericList" },
  "columns": [
    { "name": "Role", "displayName": "Role", "text": { "maxLength": 120 }, "required": true },
    { "name": "Vertical", "displayName": "Vertical", "required": true,
      "choice": { "allowTextEntry": false, "displayAs": "dropDownMenu",
        "choices": ["Engineering", "Cloud & DevOps", "Data & AI", "QA & Testing", "ERP / SAP", "Design", "Project / Delivery"] } },
    { "name": "PrimaryTech", "displayName": "Primary Technology", "required": true,
      "choice": { "allowTextEntry": true, "displayAs": "dropDownMenu",
        "choices": ["ReactJS", "Angular", "Vue.js", "Node.js", "Java", ".NET", "Python", "PHP", "Golang", "Flutter", "Android", "iOS", "React Native",
                    "DevOps", "AWS", "Azure", "GCP", "Data Engineering", "Power BI", "Data Science", "Salesforce", "SAP", "ServiceNow",
                    "QA Automation", "Manual Testing", "UI/UX", "Project Management", "Business Analysis"] } },
    { "name": "SkillSet", "displayName": "SkillSet", "text": { "allowMultipleLines": true } },
    { "name": "ExperienceYears", "displayName": "Experience (yrs)", "required": true,
      "number": { "decimalPlaces": "one", "minimum": 0, "maximum": 40 } },
    { "name": "Availability", "displayName": "Availability",
      "choice": { "allowTextEntry": false, "displayAs": "dropDownMenu",
        "choices": ["Immediate", "15 days", "30 days", "60 days", "From date"] },
      "defaultValue": { "value": "Immediate" } },
    { "name": "AvailableFrom", "displayName": "Available From", "dateTime": { "format": "dateOnly" } },
    { "name": "Location", "displayName": "Location", "text": { "maxLength": 80 } },
    { "name": "WorkMode", "displayName": "Work Mode",
      "choice": { "allowTextEntry": false, "displayAs": "checkBoxes", "choices": ["Onsite", "Hybrid", "Remote"] } },
    { "name": "Summary", "displayName": "Summary", "text": { "maxLength": 255 } },
    { "name": "CostINR", "displayName": "Cost (INR / Month)", "number": { "decimalPlaces": "none", "minimum": 0 } },
    { "name": "CostUSD", "displayName": "Cost (USD / Month)", "number": { "decimalPlaces": "none", "minimum": 0 } },
    { "name": "Published", "displayName": "Show on website", "boolean": {}, "defaultValue": { "value": "0" } },
    { "name": "InternalNotes", "displayName": "Internal Notes", "text": { "allowMultipleLines": true } }
  ]
}
```

Copy the `id` from the response. This is **`BENCH_LIST_ID`**. (Or later: **GET** `https://graph.microsoft.com/v1.0/sites/{site-id}/lists?$select=id,displayName` and find "Bench Profiles".)

| Column (display name) | Internal name | What to enter | On the website |
|---|---|---|---|
| **Profile ID** (built-in Title) | `Title` | A code such as `TNB-1042`. Letters, digits and hyphens only. Never a name | Card badge, shortlist, enquiry |
| Role | `Role` | "Senior React Developer" | Card title |
| Vertical | `Vertical` | Choice | Coloured pill filter |
| Primary Technology | `PrimaryTech` | Choice; new values can be typed in | Technology filter |
| SkillSet | `SkillSet` | Comma-separated: `React, Redux, TypeScript` | Skill chips + search |
| Experience (yrs) | `ExperienceYears` | 0–40, one decimal | Experience filter |
| Availability | `Availability` | Immediate / 15 / 30 / 60 days / From date | Availability filter + badge |
| Available From | `AvailableFrom` | Only when Availability = From date | "From 15 Dec" |
| Location | `Location` | City | Location filter |
| Work Mode | `WorkMode` | One or more | Work mode filter |
| Summary | `Summary` | One anonymised line, max 255 characters | Card text |
| Cost (INR / Month) | `CostINR` | Whole rupees per month. Blank = "On request" | ₹ price + budget filter |
| Cost (USD / Month) | `CostUSD` | Whole dollars per month. Blank = "On request" | $ price (currency toggle) |
| Show on website | `Published` | Yes to publish | Only Yes items are shown |
| Internal Notes | `InternalNotes` | Anything internal (candidate name, vendor, rate history) | **Never sent** |

Two settings Graph can't make. Do these in SharePoint (open the list → ⚙ **List settings**):

1. **Rename Title:** List settings → Columns → **Title** → Column name `Profile ID` → *Enforce unique values* **Yes** (SharePoint asks to index the column: OK) → Save. The internal name stays `Title`.
2. **Vertical choices:** edit the choices of **Vertical** or **Primary Technology** any time (column → Edit). The website builds its filters from whatever values are in use, so there's nothing to change in code.

### 12.2 Set up the entry form

SharePoint generates a form for the list. Recruiters use it via **+ New** or by opening an item.

1. **Order and hide fields:** open the list → **+ New** → in the form, top right, **Edit form** (pencil) → **Edit columns**. Drag fields into this order and untick any you don't need: Profile ID, Role, Vertical, Primary Technology, SkillSet, Experience (yrs), Availability, Available From, Location, Work Mode, Summary, Cost (INR / Month), Cost (USD / Month), Show on website, Internal Notes → **Save**.
2. **Show "Available From" only when needed:** in the same form → Edit form → **Edit columns** → hover **Available From** → ⋮ → **Edit conditional formula** →
   ```
   =if([$Availability] == 'From date', 'true', 'false')
   ```
   → Save.
3. **Optional: group the form into sections.** Edit form → **Configure layout** → *Apply formatting to*: **Body** → paste:
   ```json
   {
     "sections": [
       { "displayname": "Profile", "fields": ["Profile ID", "Role", "Vertical", "Primary Technology", "Summary"] },
       { "displayname": "Skills & experience", "fields": ["SkillSet", "Experience (yrs)"] },
       { "displayname": "Availability", "fields": ["Availability", "Available From", "Location", "Work Mode"] },
       { "displayname": "Commercials", "fields": ["Cost (INR / Month)", "Cost (USD / Month)"] },
       { "displayname": "Publishing", "fields": ["Show on website", "Internal Notes"] }
     ]
   }
   ```
   → **Save**. Field names here are the display names, so update this JSON if you rename a column.
4. **Optional, Power Apps:** for a fully custom form, use list → **Integrate → Power Apps → Customize forms**. It isn't needed for this feature.

### 12.3 Views for the team

1. **Live on website:** list → **All Items** ▾ → **Create new view** → List, name "Live on website" → then ▾ → **Edit current view**: Filter `Show on website` is equal to `Yes`; Group by `Primary Technology`; Sort by `Experience (yrs)` descending → OK.
2. **Drafts:** the same, with `Show on website` is equal to `No`.
3. **Optional: Live/Draft pill.** Hover the **Show on website** column header → ▾ → **Column settings → Format this column → Advanced mode** → paste:
   ```json
   {
     "$schema": "https://developer.microsoft.com/json-schemas/sp/v2/column-formatting.schema.json",
     "elmType": "div",
     "txtContent": "=if(@currentField, 'Live', 'Draft')",
     "style": {
       "padding": "2px 10px", "border-radius": "12px", "font-weight": "600", "display": "inline-block",
       "color": "=if(@currentField, '#2f8f5b', '#58657a')",
       "background-color": "=if(@currentField, '#e5f2ea', '#edf0f5')"
     }
   }
   ```
4. **Permissions (optional):** List settings → **Permissions for this list** → give the recruiting team **Edit**. The website doesn't need anything here; it reads through the app grant.

### 12.4 Add the RequestedProfiles column to Website Enquiries (one time)

**POST** to `https://graph.microsoft.com/v1.0/sites/{site-id}/lists/{ENQUIRY_LIST_ID}/columns`:

```json
{ "name": "RequestedProfiles", "displayName": "Requested Profiles", "text": {} }
```

Until it exists, bench requests still reach the recruiter by email (the subject reads "New Talent Bench request: Company (TNB-…)"), but the list item fails (`enquiry_list_item`, 400 `invalidRequest` in the logs). Tip: add a Website Enquiries view filtered to `Requested Profiles` *is not empty*.

### 12.5 Configure and deploy the Worker

```bash
cd worker
npx wrangler secret put BENCH_LIST_ID          # paste the list id from 12.1
# Optional: a key for instant refresh (otherwise LINKEDIN_SETUP_KEY is used)
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
npx wrangler secret put BENCH_REFRESH_KEY      # paste the value printed above
npm run check
npx wrangler deploy
```

Check it: open `https://talnxt-forms.talnxt.workers.dev/api/bench` in a browser. You should see `{"ok":true,…,"profiles":[…]}` containing only items marked **Show on website = Yes**, and no `InternalNotes`.

Then push the website (`talent-bench.html`, `js/bench.js`, `css/site.css`, `js/main.js`) to `main`; GitHub Pages deploys it. The page is linked from the footer of every page, the Contingent Staffing hero and the home page CTA, and is in `sitemap.xml`.

### 12.6 Day-to-day use

| Task | How |
|---|---|
| Add a profile | List → **+ New** → fill in → **Show on website = Yes** → Save. Live within **10 minutes** |
| Show it immediately | Open `https://talnxt-forms.talnxt.workers.dev/api/bench?refresh=<BENCH_REFRESH_KEY>` once. Visitors' browsers may keep their copy for up to 5 more minutes |
| Prepare without publishing | Leave **Show on website = No** (the default) |
| Placed / no longer available | Set **Show on website = No** (keeps history) or delete the item |
| New technology or vertical | Type it into Primary Technology, or edit the Vertical choices. Filters update automatically. A new vertical gets a colour from the spare palette; to give it a fixed colour, add it to `VERTICAL_COLOURS` in `js/bench.js` |
| Share a filtered view | Filter the page and copy the URL, e.g. `talent-bench.html?tech=reactjs,angular&avail=now` |
| Preview without SharePoint | `talent-bench.html?demo=1` loads `data/bench-sample.json` (sample data, not linked anywhere) |

### 12.7 Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Page shows "We couldn't load the bench right now" and `/api/bench` returns `bench_not_configured` | `BENCH_LIST_ID` isn't set. Run step 12.5 |
| `/api/bench` returns `bench_unavailable`; logs show `bench_fetch_failed` with `403 accessDenied` | The app's site grant is missing or on another site. Step 2.4 |
| `bench_fetch_failed` with `400 invalidRequest` | A column internal name differs. **GET** `…/lists/{BENCH_LIST_ID}/columns?$select=name,displayName` and compare with 12.1 |
| A profile doesn't appear | **Show on website** isn't Yes, Profile ID or Role is empty, or you're within the 10-minute cache (use the refresh link) |
| Shows old data while SharePoint is down | By design: the last good snapshot is served until Graph recovers (`"source":"stale"` in the JSON) |
| Bench request saved without profile IDs | `RequestedProfiles` column missing. Step 12.4 |

Logs: `cd worker && npx wrangler tail`. The page itself never shows internal error details.
