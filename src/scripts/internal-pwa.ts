/**
 * Command Center PWA client: registers /internal-sw.js, shows the offline / saved-copy / session
 * banner, captures the install prompt, keeps main pages saved for offline, and clears saved data
 * at logout. The caching rules live in the worker (public/internal-sw.js); contract:
 * .ai/references/internal-pwa.md. Imported by InternalLayout (every internal page) and by the
 * Tools page card, so module state (the captured install prompt) is shared between them.
 */

export const SW_URL = '/internal-sw.js';
// No trailing slash on purpose: Pages serves the Dashboard at /internal (/internal/ redirects to it).
export const SW_SCOPE = '/internal';
const WARM_KEY = 'clearview:pwa:warmed';
const WARM_EVERY_MS = 6 * 60 * 60 * 1000;
const CLEAR_WAIT_MS = 1500;

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

export type WorkerStatus = {
  version: string;
  pages: number;
  assets: number;
  data: number;
  newestDataAt: number | null;
};

export type PwaStatus = {
  supported: boolean;
  controlled: boolean;
  standalone: boolean;
  ios: boolean;
  canInstall: boolean;
  online: boolean;
  persisted: boolean | null;
  worker: WorkerStatus | null;
};

let installPrompt: InstallPrompt | null = null;
let started = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export const onPwaChange = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: minimal-ui)').matches || nav.standalone === true;
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports as a Mac with touch.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function worker(): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.ready.then((r) => navigator.serviceWorker.controller || r.active || null).catch(() => null);
}

/** Send one message and wait for the worker's reply of the given type (or null on timeout). */
function ask<T extends { type: string }>(message: Record<string, unknown>, replyType: string, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    if (!('serviceWorker' in navigator)) return resolve(null);
    const done = (value: T | null) => { navigator.serviceWorker.removeEventListener('message', onMessage); clearTimeout(timer); resolve(value); };
    const onMessage = (event: MessageEvent) => { if (event.data && event.data.type === replyType) done(event.data as T); };
    const timer = setTimeout(() => done(null), timeoutMs);
    navigator.serviceWorker.addEventListener('message', onMessage);
    worker().then((sw) => { if (sw) sw.postMessage(message); else done(null); });
  });
}

/** Remove saved customer data. `all` also drops saved pages and assets (the Tools "reset" button). */
export async function clearSavedData(scope: 'data' | 'all' = 'data'): Promise<boolean> {
  const reply = await ask<{ type: string }>({ type: 'cv:clear', scope }, 'cv:cleared', CLEAR_WAIT_MS);
  if (scope === 'all') { try { localStorage.removeItem(WARM_KEY); } catch { /* ignore */ } }
  return reply !== null;
}

/** Save the main pages for offline use. Returns the worker's report, or null when unavailable. */
export async function warmPages(): Promise<{ ok: boolean; signedOut?: boolean; saved?: number; failed?: string[] } | null> {
  const result = await ask<{ type: string; ok: boolean; signedOut?: boolean; saved?: number; failed?: string[] }>({ type: 'cv:warm' }, 'cv:warm-done', 60_000);
  if (result?.ok) { try { localStorage.setItem(WARM_KEY, String(Date.now())); } catch { /* ignore */ } }
  notify();
  return result;
}

export function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = installPrompt;
  if (!prompt) return Promise.resolve('unavailable');
  installPrompt = null;
  notify();
  return prompt.prompt().then(() => prompt.userChoice).then((choice) => choice.outcome).catch(() => 'dismissed' as const);
}

export async function getPwaStatus(): Promise<PwaStatus> {
  const supported = 'serviceWorker' in navigator;
  let persisted: boolean | null = null;
  try { if (navigator.storage?.persisted) persisted = await navigator.storage.persisted(); } catch { /* ignore */ }
  const worker = supported ? await ask<WorkerStatus & { type: string }>({ type: 'cv:status' }, 'cv:status', 2500) : null;
  return {
    supported,
    controlled: supported && !!navigator.serviceWorker.controller,
    standalone: isStandalone(),
    ios: isIos(),
    canInstall: installPrompt !== null,
    online: navigator.onLine,
    persisted,
    worker: worker ? { version: worker.version, pages: worker.pages, assets: worker.assets, data: worker.data, newestDataAt: worker.newestDataAt } : null,
  };
}

export function formatAge(ms: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function banner() {
  const el = document.querySelector<HTMLElement>('[data-pwa-banner]');
  const text = el?.querySelector<HTMLElement>('[data-pwa-banner-text]') || null;
  const action = el?.querySelector<HTMLAnchorElement>('[data-pwa-banner-action]') || null;
  return { el, text, action };
}

type BannerState = { kind: 'offline' | 'stale' | 'session'; text: string; actionHref?: string; actionLabel?: string };

function showBanner(state: BannerState | null) {
  const { el, text, action } = banner();
  if (!el || !text || !action) return;
  if (!state) { el.hidden = true; delete el.dataset.kind; return; }
  el.hidden = false;
  el.dataset.kind = state.kind;
  text.textContent = state.text;
  if (state.actionHref && state.actionLabel) { action.hidden = false; action.href = state.actionHref; action.textContent = state.actionLabel; }
  else { action.hidden = true; }
}

const OFFLINE_TEXT = 'Offline. Saved copies are shown where available. Photos still save to this phone; approvals, quotes and payments need a connection.';

export function initInternalPwa(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const authed = document.body.dataset.internalAuthed === 'true';
  let sessionExpired = false;
  let staleSince: number | null = null;

  const refreshBanner = () => {
    if (sessionExpired) {
      const next = encodeURIComponent(location.pathname + location.search);
      return showBanner({ kind: 'session', text: 'Your session ended. Sign in again to load live data.', actionHref: `/internal/login?next=${next}`, actionLabel: 'Sign in' });
    }
    if (!navigator.onLine) return showBanner({ kind: 'offline', text: OFFLINE_TEXT });
    if (staleSince !== null) return showBanner({ kind: 'stale', text: `Showing a saved copy from ${formatAge(staleSince)}; the connection is weak. It refreshes when it improves.` });
    showBanner(null);
  };

  window.addEventListener('online', () => { staleSince = null; refreshBanner(); if (authed) void maybeWarm(); notify(); });
  window.addEventListener('offline', () => { refreshBanner(); notify(); });
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event as InstallPrompt; notify(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; notify(); });
  refreshBanner();

  // Standalone has no browser chrome; give detail pages a way back.
  const back = document.querySelector<HTMLButtonElement>('[data-pwa-back]');
  if (back && isStandalone()) {
    back.hidden = history.length <= 1;
    back.addEventListener('click', () => history.back());
  }

  // Logout wipes saved customer data first, then continues with the normal form post.
  const logout = document.querySelector<HTMLFormElement>('form[action="/internal/api/logout"]');
  logout?.addEventListener('submit', (event) => {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    event.preventDefault();
    void clearSavedData('data').finally(() => logout.submit());
  });

  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'cv:stale-data') { staleSince = Number(data.cachedAt) || Date.now(); refreshBanner(); }
    else if (data.type === 'cv:auth-expired') { sessionExpired = true; refreshBanner(); }
  });

  navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, updateViaCache: 'none' }).then(
    () => {
      // The login page is where a session starts or ends: nothing from the last one stays saved.
      if (!authed) void clearSavedData('data');
      else void maybeWarm();
    },
    () => { /* unsupported or blocked: the site works exactly as before */ },
  );

  if (authed && isStandalone() && navigator.storage?.persist) {
    // Job photos live only in this browser's storage until cloud backup is connected; ask the
    // browser not to evict them under storage pressure.
    void navigator.storage.persist().then(() => notify(), () => { /* ignore */ });
  }
}

async function maybeWarm() {
  if (!navigator.onLine) return;
  let last = 0;
  try { last = Number(localStorage.getItem(WARM_KEY)) || 0; } catch { /* ignore */ }
  if (Date.now() - last < WARM_EVERY_MS) return;
  await warmPages();
}
