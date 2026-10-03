/**
 * Command Center PWA client: registers /internal-sw.js, shows the offline / saved-copy / session
 * banner, captures the install prompt, keeps main pages saved for offline, and clears saved data
 * at logout. The caching rules live in the worker (public/internal-sw.js); contract:
 * .ai/references/internal-pwa.md. Imported by InternalLayout (every internal page) and by the
 * Tools page card, so module state (the captured install prompt) is shared between them.
 */

import { bannerFor, buildLabel, formatAge, pageIsStale, shouldCheckForUpdate, shouldWarm, updateAction, type BannerState } from '../lib/pwa-logic';

export { formatAge };
export const SW_URL = '/internal-sw.js';
// No trailing slash on purpose: Pages serves the Dashboard at /internal (/internal/ redirects to it).
export const SW_SCOPE = '/internal';
const UPDATE_RELOAD_KEY = 'clearview:pwa:update-reload';
const UPDATE_INTERVAL_MS = 30 * 60 * 1000;
const CLEAR_WAIT_MS = 1500;

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

export type WarmState = { okAt?: number; okBuild?: string; attemptAt?: number; attemptBuild?: string; running?: boolean };

export type WorkerStatus = {
  version: string;
  build: string;
  warm: WarmState;
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
  /** Build this page was served from, and the build of the worker running it ("dev" when not stamped). */
  pageBuild: string;
  workerBuild: string | null;
};

let installPrompt: InstallPrompt | null = null;
let started = false;
let workerBuild: string | null = null;
let lastUpdateCheck = 0;
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
  return reply !== null;
}

/** Save the main pages for offline use. Returns the worker's report, or null when unavailable. */
export async function warmPages(): Promise<{ ok: boolean; signedOut?: boolean; saved?: number; failed?: string[] } | null> {
  const result = await ask<{ type: string; ok: boolean; signedOut?: boolean; saved?: number; failed?: string[] }>({ type: 'cv:warm' }, 'cv:warm-done', 60_000);
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
    pageBuild: pageBuild(),
    workerBuild: worker ? worker.build : null,
    worker: worker ? { version: worker.version, build: worker.build, warm: worker.warm || {}, pages: worker.pages, assets: worker.assets, data: worker.data, newestDataAt: worker.newestDataAt } : null,
  };
}

export function pageBuild(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="cv-build"]')?.content || 'dev';
}

export { buildLabel };

/** Anything typed into a form on this page that has not been saved. Controls filled in by script count too, so this errs toward "dirty". */
function hasUnsavedInput(): boolean {
  for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
    if (el instanceof HTMLInputElement) {
      if (['hidden', 'button', 'submit', 'reset', 'file'].includes(el.type)) continue;
      if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) return true; }
      else if (el.value !== el.defaultValue) return true;
    } else if (el instanceof HTMLTextAreaElement) {
      if (el.value !== el.defaultValue) return true;
    } else if (el instanceof HTMLSelectElement) {
      if (Array.from(el.options).some((o) => o.selected !== o.defaultSelected)) return true;
    }
  }
  return false;
}

/** Ask the worker for its status; also refreshes `workerBuild`. */
async function askStatus(): Promise<(WorkerStatus & { type: string }) | null> {
  const reply = await ask<WorkerStatus & { type: string }>({ type: 'cv:status' }, 'cv:status', 2500);
  if (reply?.build) workerBuild = reply.build;
  return reply;
}

async function refreshWorkerBuild(): Promise<string | null> {
  await askStatus();
  return workerBuild;
}

/** Ask the browser to look for a new worker now. Resolves once the check has finished. */
export async function checkForUpdate(): Promise<'unsupported' | 'checked'> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (!registration) return 'unsupported';
  lastUpdateCheck = Date.now();
  try { await registration.update(); } catch { /* offline or blocked: try again later */ }
  await refreshWorkerBuild();
  notify();
  return 'checked';
}

function banner() {
  const el = document.querySelector<HTMLElement>('[data-pwa-banner]');
  const text = el?.querySelector<HTMLElement>('[data-pwa-banner-text]') || null;
  const action = el?.querySelector<HTMLAnchorElement>('[data-pwa-banner-action]') || null;
  return { el, text, action };
}

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

export function initInternalPwa(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const authed = document.body.dataset.internalAuthed === 'true';
  let sessionExpired = false;
  let staleSince: number | null = null;
  let updateReady = false;

  const refreshBanner = () => showBanner(bannerFor({ sessionExpired, online: navigator.onLine, staleSince, updateReady, path: location.pathname + location.search }));

  // This page is older than the worker serving it (a deploy happened while the app was open or in the background).
  // Reload when that cannot lose anything; otherwise offer the Reload link. See updateAction.
  const evaluateUpdate = () => {
    const lastReloadAt = (() => { try { return Number(sessionStorage.getItem(UPDATE_RELOAD_KEY)) || 0; } catch { return 0; } })();
    const action = updateAction({ stale: pageIsStale(pageBuild(), workerBuild), online: navigator.onLine, hidden: document.hidden, dirty: hasUnsavedInput(), lastReloadAt, now: Date.now() });
    updateReady = action === 'banner';
    refreshBanner();
    if (action === 'reload-now') {
      try { sessionStorage.setItem(UPDATE_RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
      location.reload();
    }
    notify();
  };
  const maybeCheckForUpdate = () => {
    if (shouldCheckForUpdate({ now: Date.now(), online: navigator.onLine, lastCheck: lastUpdateCheck })) void checkForUpdate().then(evaluateUpdate);
  };

  window.addEventListener('online', () => { staleSince = null; refreshBanner(); maybeCheckForUpdate(); if (authed) void maybeWarm(); notify(); });
  // A phone app can sit in the background for days: look for a new version whenever it comes back to the front.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { evaluateUpdate(); maybeCheckForUpdate(); } });
  setInterval(() => { if (!document.hidden) maybeCheckForUpdate(); }, UPDATE_INTERVAL_MS);
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
    else if (data.type === 'cv:activated') { if (data.build) workerBuild = String(data.build); evaluateUpdate(); if (authed) void maybeWarm(); }
  });

  navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, updateViaCache: 'none' }).then(
    () => {
      // The login page is where a session starts or ends: nothing from the last one stays saved.
      if (!authed) { void clearSavedData('data'); return; }
      void refreshWorkerBuild().then(() => { evaluateUpdate(); return maybeWarm(); });
    },
    () => { /* unsupported or blocked: the site works exactly as before */ },
  );

  if (authed && isStandalone() && navigator.storage?.persist) {
    // Job photos live only in this browser's storage until cloud backup is connected; ask the
    // browser not to evict them under storage pressure.
    void navigator.storage.persist().then(() => notify(), () => { /* ignore */ });
  }
}

/**
 * Ask the worker to save pages when that is due. The worker keeps the warm-up state (see readWarmState in
 * public/internal-sw.js), so this works however often pages are opened and closed while a run is in progress.
 */
async function maybeWarm() {
  const status = await askStatus();
  if (!status) return;
  const warm = status.warm || {};
  const buildChanged = warm.okBuild !== status.build;
  const lastAttempt = warm.attemptBuild === status.build ? warm.attemptAt || 0 : 0;
  if (!shouldWarm({ now: Date.now(), online: navigator.onLine, lastOk: warm.okAt || 0, lastAttempt, buildChanged, running: !!warm.running })) return;
  await warmPages();
}
