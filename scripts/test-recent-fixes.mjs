import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
};

const photos = read('src/pages/internal/tools/photos.astro');
const login = read('functions/internal/api/login.js');
const payments = read('functions/internal/api/payments.js');
const invoiceView = read('src/pages/internal/invoices/view.astro');
const internalLayout = read('src/layouts/InternalLayout.astro');
const sitemap = read('astro.config.mjs');
const robots = read('src/pages/robots.txt.ts');
const estimate = read('functions/api/estimate.js');

// #74 regression guards: the active stage must actually constrain the grid,
// and stale async renders must not overwrite a newer filter selection.
assert(/\.filter\(p=>p\.stage===stage\)/.test(photos), 'photo grid filters by active stage');
assert(/let renderVersion=0/.test(photos) && /const version=\+\+renderVersion/.test(photos), 'photo renders use a generation guard');
assert(/if\(version!==renderVersion\)return/.test(photos), 'stale photo renders are discarded');
assert(/let savedCount=0/.test(photos) && /savedCount\+\+/.test(photos), 'photo capture reports only successfully saved images');
assert(/activeUrls\.forEach\(URL\.revokeObjectURL\)/.test(photos), 'photo object URLs are revoked before replacement');

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

// SEO privacy fixes must cover the exact /internal route as well as children.
assert(/path !== '\/internal'/.test(sitemap) && /path\.startsWith\('\/internal\/'\)/.test(sitemap), 'sitemap excludes /internal and descendants');
assert(/Disallow: \/internal\n/.test(robots), 'robots excludes /internal and its descendants');

// Keep the multi-field estimate validation contract intact.
assert(/fieldErrors/.test(estimate) && /json\(\{ error: 'Fix the highlighted fields\.', fields: fieldErrors \}/.test(estimate), 'estimate API returns field-specific validation errors');

console.log('Recent-fix regression checks passed.');
