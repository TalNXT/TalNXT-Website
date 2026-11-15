# Website forms backend: setup guide

This guide connects the website's **enquiry form** (home, Contingent Staffing and People & HR pages) and **job application form** (Careers page, plus the "Submit Your Resume" buttons) to Microsoft 365. It runs on free tiers only.

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

**Exchange admin center → Recipients → Mailboxes → Add a shared mailbox**, for example `careers@talnxt.com` (the name is up to you). This is **`MAIL_FROM`**. Notifications and acknowledgements are sent from it, and replies from candidates and clients land in it, so give the recruiters access.

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
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'careers@talnxt.com'"

# 2) Register the app's service principal in Exchange.
#    ObjectId = Entra admin center -> Enterprise applications -> "TalNXT Website Forms" -> Object ID
#    (the ENTERPRISE APPLICATION's object ID, not the one on the App registration page)
New-ServicePrincipal -AppId <CLIENT_ID> -ObjectId <ENTERPRISE_APP_OBJECT_ID> -DisplayName "TalNXT Website Forms"

# 3) Allow Mail.Send only inside that scope
New-ManagementRoleAssignment -App <CLIENT_ID> -Role "Application Mail.Send" -CustomResourceScope "TalNXT Forms Sender"

# 4) Check: the first should show InScope = True, the second False
Test-ServicePrincipalAuthorization -Identity <CLIENT_ID> -Resource careers@talnxt.com
Test-ServicePrincipalAuthorization -Identity <CLIENT_ID> -Resource <any-other-user>@talnxt.com
```

Changes can take **30 minutes to 2 hours** to take effect.

### 3.3 Option B (legacy): Application Access Policy

Microsoft is replacing Application Access Policies with RBAC for Applications, so use this only if Option A isn't available to you.

1. In Entra, **add Mail.Send (Application)** to the app and grant admin consent.
2. Restrict it:

```powershell
Connect-ExchangeOnline
New-DistributionGroup -Name "TalNXT Forms Senders" -Type Security -Members careers@talnxt.com
New-ApplicationAccessPolicy -AppId <CLIENT_ID> -PolicyScopeGroupId "TalNXT Forms Senders" `
  -AccessRight RestrictAccess -Description "Website forms may send only as the careers mailbox"
Test-ApplicationAccessPolicy -Identity careers@talnxt.com -AppId <CLIENT_ID>         # Granted
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
| LinkedIn posts on the home page | `data/linkedin-posts.json` (instructions inside the file) |
| Privacy policy text | `privacy.html` |

---

## 7. Cost and limits (₹0/month at 10–100 submissions)

| Service | Free allowance | What happens at the limit |
|---|---|---|
| Cloudflare Workers Free | 100,000 requests/day, 10 ms CPU per request | Requests fail. **No charge** without a paid plan |
| Workers rate-limiting binding | Included | — |
| Workers Logs | Included daily quota on the free plan | Extra logs are dropped |
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
| LinkedIn section missing on the home page | `data/linkedin-posts.json` isn't valid JSON. Paste it into a JSON validator |
| A LinkedIn embed shows "post unavailable" | The post isn't public, or the `embedUrl` is wrong. Use the `src` from LinkedIn's **Embed this post** code, or give the item a `title` and remove `embedUrl` to show a link card instead |
