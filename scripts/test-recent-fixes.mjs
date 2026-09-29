import fs from 'node:fs';
import { pacificDayRange } from '../functions/internal/api/dashboard.js';

const read = (path) => fs.readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

const photos = read('src/pages/internal/tools/photos.astro');
const login = read('functions/internal/api/login.js');
const payments = read('functions/internal/api/payments.js');
const invoices = read('functions/internal/_lib/invoices.mjs');
const invoiceView = read('src/pages/internal/invoices/view.astro');
const internalLayout = read('src/layouts/InternalLayout.astro');
const sitemap = read('astro.config.mjs');
const robots = read('src/pages/robots.txt.ts');
const estimate = read('functions/api/estimate.js');
const estimateForm = read('src/components/EstimateForm.astro');
const costEstimator = read('src/components/CostEstimator.astro');
const dashboardApi = read('functions/internal/api/dashboard.js');
const todayPage = read('src/pages/internal/today.astro');
const today = read('src/pages/internal/today.astro');
const followUp = read('src/pages/internal/follow-up.astro');
const jobPrep = read('src/pages/internal/jobs/prepare.astro');
const measurements = read('src/pages/internal/tools/measurements.astro');
const quoteApi = read('functions/internal/api/quotes/index.js');
const jobsApi = read('functions/internal/api/jobs.js');
const tasksApi = read('functions/internal/api/tasks.js');
const askPage = read('src/pages/ask.astro');
const jobList = read('src/pages/internal/jobs/index.astro');
const quoteList = read('src/pages/internal/quotes/index.astro');

// #74 regression guards: the active stage must actually constrain the grid,
// and stale async renders must not overwrite a newer filter selection.
assert(/\.filter\(p=>p\.stage===stage\)/.test(photos), 'photo grid filters by active stage');
assert(/let renderVersion=0/.test(photos) && /const version=\+\+renderVersion/.test(photos), 'photo renders use a generation guard');
assert(/if\(version!==renderVersion\)return/.test(photos), 'stale photo renders are discarded');
assert(/let savedCount=0/.test(photos) && /savedCount\+\+/.test(photos), 'photo capture reports only successfully saved images');
assert(/activeUrls\.forEach\(URL\.revokeObjectURL\)/.test(photos), 'photo object URLs are revoked before replacement');
assert(/clearview-photo-backup/.test(photos) && /dataUrl/.test(photos) && /data-import-trigger/.test(photos), 'photo backup includes originals and can be restored');
assert(/data-save-error/.test(measurements) && /Not saved — export this worksheet now/.test(measurements), 'measurement storage failure is visible instead of silently losing changes');
assert(/data-import-trigger/.test(measurements) && /clearview-measurements/.test(measurements) && /Backup restored/.test(measurements), 'measurement backup can be exported and restored');
assert(/field\.addEventListener\('input'/.test(measurements), 'measurement dimensions and quantities recalculate during typing');
assert(/LIMIT \? OFFSET \?/.test(jobsApi) && /totalPages/.test(jobsApi) && /data-page-next/.test(jobList), 'job history has API and UI pagination');
assert(/LIMIT \? OFFSET \?/.test(quoteApi) && /totalPages/.test(quoteApi) && /data-page-next/.test(quoteList), 'quote history has API and UI pagination');
assert(/LIMIT \? OFFSET \?/.test(tasksApi) && /totalPages/.test(tasksApi) && /data-page-next/.test(followUp), 'follow-up history has API and UI pagination');
assert(/action="\/ask\/api\/chat" method="post"/.test(askPage), 'Ask composer declares a non-GET native submit route');
assert(/image\/heic,image\/heif/.test(askPage) && /createImageBitmap\(file\)/.test(askPage) && /cannot decode that HEIC\/HEIF/.test(askPage), 'Ask photo picker accepts supported mobile formats and explains decoder limits');

// Login hardening should compare fixed-size digests rather than branch on
// password length. Keep the security rationale aligned with the implementation.
assert(/crypto\.subtle\.digest\('SHA-256'/.test(login), 'login hashes both password values');
assert(/for \(let i = 0; i < bytesA\.length; i\+\+\)/.test(login), 'login compares the fixed-size digest byte loop');
assert(!/length mismatch.*leak/i.test(login), 'login comment does not claim impossible length-side-channel guarantees');

// Payment/invoice synchronization must remain wired at the mutation point and
// the UI must retain the paid state instead of treating it as merely sent/open.
assert(/syncInvoiceStatus\(env\.QUOTES_DB, job\.quote_id, amountPaid, now\)/.test(payments), 'payments sync the matching invoice');
assert(/status === 'paid'/.test(invoiceView), 'invoice view renders paid state');
assert(/invoice\.status === 'paid'/.test(internalLayout), 'quote/job actions recognize paid invoices');
assert(/status = CASE WHEN status = 'paid' THEN 'paid' ELSE 'sent' END/.test(invoices), 're-emailing a paid invoice preserves paid status');
assert(!/UPDATE invoices SET status = 'sent', sent_at/.test(invoices), 'invoice email cannot unconditionally downgrade status to sent');

// SEO privacy fixes must cover the exact /internal route as well as children.
assert(/path !== '\/internal'/.test(sitemap) && /path\.startsWith\('\/internal\/'\)/.test(sitemap), 'sitemap excludes /internal and descendants');
assert(/Disallow: \/internal\r?\n/.test(robots), 'robots excludes /internal and its descendants');

// The single-column calculator grid must not use a bare `1fr` track: its
// implicit min-content minimum pushed the page 1px wider than a 375px phone.
assert(/\.estimator-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/.test(costEstimator), 'calculator mobile grid cannot overflow the viewport');
assert(/params\.has\('scope'\) \? params\.get\('scope'\)/.test(estimateForm) && /sessionStorage\.getItem\('clearview:scope'\)/.test(estimateForm) && /notes\.value = parts\.join/.test(estimateForm), 'calculator scope carries into estimate notes');
assert(/scope\.trim\(\)\.slice\(0, 400\)/.test(estimateForm) && /sessionStorage\.removeItem\('clearview:scope'\)/.test(estimateForm), 'calculator scope is bounded and consumed once');

// Keep the multi-field estimate validation contract intact.
assert(/fieldErrors/.test(estimate) && /json\(\{ error: 'Fix the highlighted fields\.', fields: fieldErrors \}/.test(estimate), 'estimate API returns field-specific validation errors');
assert(/RECEIPT_COOLDOWN_MS = 24 \* 60 \* 60 \* 1000/.test(estimate), 'customer estimate receipts use a 24-hour cooldown');
assert(/INSERT INTO estimate_receipt_limits[\s\S]*ON CONFLICT\(email_hash\)[\s\S]*RETURNING email_hash/.test(estimate), 'estimate receipt cooldown claim is atomic and keyed by email hash');
assert(/shouldSendReceipt = await claimReceiptEmail\(context\.env\?\.QUOTES_DB, lead\.email\)/.test(estimate), 'receipt cooldown only gates customer confirmation mail');
assert(/await sendTemplate\(key, \{[\s\S]*template:[\s\S]*id: TEMPLATES\.lead\.id/.test(estimate), 'Mark notification remains independent of the customer receipt cooldown');
assert(/context\.waitUntil\(logLead\(context\.env, lead, journey, visitorId\)\)/.test(estimate), 'every accepted estimate continues to save the lead');
assert(/@media \(max-width: 900px\) \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/.test(costEstimator), 'mobile calculator grid permits columns to shrink below min-content width');
assert(/\.estimator-grid > \* \{\s*min-width: 0;\s*\}/.test(costEstimator), 'calculator grid children cannot force horizontal page overflow');

// The Today and Follow-up screens must target the task list correctly and not
// hide failed completion requests behind an unconditional refresh.
assert(/q\('\[data-tasks\]'\)/.test(today), 'today screen selects the task list');
assert(/if\(!r\.ok\)throw new Error\(d\.error\|\|'Could not complete that follow-up\.'\)/.test(today), 'today screen checks task completion responses');
assert(/if\(!r\.ok\)throw new Error\(d\.error\|\|'Could not complete that follow-up\.'\)/.test(followUp), 'follow-up screen checks task completion responses');
assert(/dueDate&&!Number\.isFinite\(dueDate\.getTime\(\)\)/.test(followUp), 'follow-up screen rejects invalid due dates before sending');
assert(/submit\.disabled=true;submit\.textContent='Saving…'/.test(followUp) && /finally\{if\(submit instanceof HTMLButtonElement\)\{submit\.disabled=false/.test(followUp), 'follow-up form prevents duplicate submissions and restores its button');
assert(/try\{note\.value=localStorage\.getItem\(noteKey\)\|\|'';\}catch/.test(jobPrep) && /catch\{if\(saveState\)saveState\.textContent='Could not save on this browser/.test(jobPrep), 'job prep handles browser storage errors without losing the page');
assert(/new URLSearchParams\(location\.search\)\.get\('leadId'\)/.test(followUp), 'follow-up handoff reads the selected lead from the link');
assert(/leadIdInput\.value=linkedLeadId;addCard\.hidden=false/.test(followUp), 'follow-up handoff opens with the inquiry already linked');
assert(/data-linked-lead/.test(followUp) && /For \$\{lead\.name\}/.test(followUp), 'follow-up form identifies the linked customer');
assert(/form\.reset\(\);if\(linkedLeadId&&leadIdInput instanceof HTMLInputElement\)leadIdInput\.value=linkedLeadId/.test(followUp), 'repeat follow-ups remain linked to the selected inquiry');
assert(/timeZone: 'America\/Los_Angeles'/.test(dashboardApi) && /pacificDayRange/.test(dashboardApi), 'dashboard due-today counts use the business timezone');
assert(/due_at >= \? AND due_at < \?/.test(dashboardApi) && /\.bind\(weekAgo, today\.start, today\.end, now\)/.test(dashboardApi), 'dashboard due-today counts use exact local-day boundaries');
assert(/due_at < \?\) AS tasks_overdue/.test(dashboardApi) && /\.bind\(weekAgo, today\.start, today\.end, now\)/.test(dashboardApi), 'overdue counts compare consistent ISO timestamps');
assert(/AS active_jobs/.test(dashboardApi) && /Number\(c\.active_jobs\)\|\|0/.test(todayPage), 'Today active-job count is not limited to the preview list');
assert(JSON.stringify(pacificDayRange(new Date('2026-03-08T18:00:00Z'))) === JSON.stringify({ start: '2026-03-08T08:00:00.000Z', end: '2026-03-09T07:00:00.000Z' }), 'Pacific due-today range handles spring daylight-saving transition');
assert(JSON.stringify(pacificDayRange(new Date('2026-11-01T18:00:00Z'))) === JSON.stringify({ start: '2026-11-01T07:00:00.000Z', end: '2026-11-02T08:00:00.000Z' }), 'Pacific due-today range handles fall daylight-saving transition');

console.log('Recent-fix regression checks passed.');
