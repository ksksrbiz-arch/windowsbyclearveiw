// Post-job Google review request. Deterministic: it only ever sends a link to
// Clearview's own Google Business Profile and a short, fixed ask. It never
// drafts, suggests, or pre-fills review text (see HANDOFF rule 1).

// Kept in sync with src/data/site.ts `social.google` by hand. Functions in
// this repo do not import from src/ (see functions/internal/_lib/quotes.mjs).
const PROFILE_SHARE_URL = 'https://share.google/cdPgOCHSjkwMazSOC';
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

// Best link first: an explicit override, then Google's direct "write a review"
// form when the pinned Place ID is configured, then the profile share link.
export function reviewUrl(env) {
  const override = String(env?.GOOGLE_REVIEW_URL || '').trim();
  if (/^https:\/\/[^\s"'<>]+$/.test(override)) return override;
  const placeId = String(env?.GOOGLE_PLACE_ID || '').trim();
  if (PLACE_ID_PATTERN.test(placeId)) {
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
  }
  return PROFILE_SHARE_URL;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0].slice(0, 60);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function smsBody(name, url) {
  const hi = firstName(name) ? `Hi ${firstName(name)}, ` : 'Hi, ';
  return `${hi}thanks for choosing Clearview Windows. If you have a minute, an honest Google review helps a local business like ours a lot: ${url}`;
}

export function reviewEmail(name, url) {
  const greeting = firstName(name) ? `Hi ${escapeHtml(firstName(name))},` : 'Hi,';
  const safeUrl = escapeHtml(url);
  const text = [
    firstName(name) ? `Hi ${firstName(name)},` : 'Hi,',
    '',
    'Thanks again for having us out to work on your windows.',
    'If you have a minute, an honest Google review helps a local business like ours more than almost anything else:',
    url,
    '',
    'If anything about the job is not right, just reply to this email and we will make it right first.',
    '',
    'Clearview Windows',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:#111;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;">
<tr><td style="padding:28px;font-size:16px;line-height:24px;">
<p style="margin:0 0 16px;">${greeting}</p>
<p style="margin:0 0 16px;">Thanks again for having us out to work on your windows.</p>
<p style="margin:0 0 24px;">If you have a minute, an honest Google review helps a local business like ours more than almost anything else.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0f2a54" style="border-radius:8px;">
<a href="${safeUrl}" style="display:block;padding:14px 22px;color:#ffffff;font-weight:bold;text-decoration:none;">Leave a Google review</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:20px;color:#555;">If anything about the job is not right, just reply to this email and we will make it right first.</p>
<p style="margin:16px 0 0;">Clearview Windows</p>
</td></tr></table></body></html>`;
  return { subject: 'Thanks from Clearview Windows', text, html };
}
