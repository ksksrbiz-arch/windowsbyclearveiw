import { INTENT_EVENTS, normalizeIntent } from '../../functions/_lib/intent.mjs';

const KEY = 'clearview:intent';
let seen = new Set<string>();
let timer: ReturnType<typeof setInterval> | undefined;
function allowed() { return !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl && navigator.doNotTrack !== '1'; }
function state() {
  try { return normalizeIntent(JSON.parse(localStorage.getItem(KEY) || 'null')) || { version: 1, startedAt: Date.now(), sessions: 1, counts: {} }; } catch { return null; }
}
export function trackIntent(name: string, once = true) {
  if (!allowed() || !INTENT_EVENTS.includes(name) || (once && seen.has(name))) return;
  seen.add(name);
  try {
    const data = state();
    if (data) { data.counts[name] = Math.min(100, (data.counts[name] || 0) + 1); localStorage.setItem(KEY, JSON.stringify(data)); }
    const w = window as Window & { dataLayer?: object[] };
    w.dataLayer ||= [];
    // Only fixed event names and a public route. Never field values, link text,
    // query strings, calculator prices, email addresses or our browser ID.
    w.dataLayer.push({ event: 'cv_intent', cv_event_name: name, cv_page_path: location.pathname, cv_page_location: location.origin + location.pathname });
  } catch { /* Tracking must never interrupt a customer action. */ }
}
export function readIntent() { return allowed() ? state() : null; }
let activeRoot: Element | null;
function page() {
  const root = document.querySelector("main");
  if (root && root === activeRoot) return;
  activeRoot = root;
  seen = new Set();
  clearInterval(timer);
  if (!allowed()) return;
  try {
    const now = Date.now();
    const last = Number(localStorage.getItem('clearview:intent_last') || 0);
    const data = state();
    if (data && last && now - last > 30 * 60000 && now - last < 90 * 86400000) {
      data.sessions = Math.min(100, data.sessions + 1);
      localStorage.setItem(KEY, JSON.stringify(data));
      trackIntent('return_visit');
    } else if (data) localStorage.setItem(KEY, JSON.stringify(data));
    localStorage.setItem('clearview:intent_last', String(now));
  } catch {}
  const path = location.pathname;
  if (/\/tools\/.*cost|\/guides\/.*cost/.test(path)) trackIntent('pricing_view');
  if (/^\/(replacement|new-construction|sliding-glass-doors|siding|window-features)(\/|$)/.test(path)) trackIntent('service_view');
  if (path.replace(/\/$/, '') === '/reviews') trackIntent('reviews_view');
  let seconds = 0;
  timer = setInterval(() => {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    try { localStorage.setItem('clearview:intent_last', String(Date.now())); } catch {}
    if (++seconds === 30) { trackIntent('page_engaged'); }
  }, 1000);
}
document.addEventListener('click', event => {
  const element = event.target instanceof Element ? event.target : null;
  if (element?.closest('[data-window-studio] [data-start]')) trackIntent('studio_start');
  const link = element?.closest<HTMLAnchorElement>('a[href]');
  if (link) {
    const href = link.getAttribute('href') || '';
    if (href.startsWith('tel:')) trackIntent('phone_interest', false);
    else if (href.startsWith('mailto:')) trackIntent('email_click', false);
    else {
      try {
        const url = new URL(href, location.href);
        if (link.hasAttribute('data-handoff')) trackIntent('calculator_handoff');
        if (url.origin === location.origin && url.pathname === '/estimate') trackIntent('estimate_interest', false);
        if (url.origin === location.origin && url.pathname === '/reviews' || /(^|\.)(google\.com|g\.page|share\.google)$/.test(url.hostname) && /review|maps|share\.google/.test(url.href)) trackIntent('review_click', false);
        if (link.hasAttribute('download') || /\.(pdf|glb|zip)$/i.test(url.pathname)) trackIntent('download_click', false);
        if (url.origin !== location.origin) trackIntent('outbound_click', false);
        if (location.pathname === '/gallery' && /\.(jpe?g|png|webp)$/i.test(url.pathname)) trackIntent('gallery_open', false);
      } catch {}
    }
  }
});
document.addEventListener('focusin', event => {
  const input = event.target instanceof Element ? event.target : null;
  if (!input?.matches('input:not([type="hidden"]),textarea,select')) return;
  if (input.closest('[data-ask-form]')) trackIntent('consultant_start');
  else if (input.closest('[data-callback-form]')) trackIntent('callback_form_start');
  else if (input.closest('form[action="/api/estimate"]')) trackIntent('estimate_form_start');
});
document.addEventListener('invalid', event => {
  if (event.target instanceof Element && event.target.closest('#estimate-form')) { trackIntent('estimate_form_attempt'); trackIntent('estimate_form_error'); }
}, true);
document.addEventListener('toggle', event => {
  if (event.target instanceof HTMLDetailsElement && event.target.open && event.target.closest('main')) trackIntent('faq_open', false);
}, true);
page();
document.addEventListener('astro:page-load', page);
document.addEventListener('astro:before-swap', () => clearInterval(timer));
