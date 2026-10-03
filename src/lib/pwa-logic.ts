/**
 * Pure decisions behind the Command Center PWA client (src/scripts/internal-pwa.ts), kept free of
 * the DOM so `npm run test:internal-pwa` can run them. Contract: .ai/references/internal-pwa.md.
 */

export const WARM_EVERY_MS = 6 * 60 * 60 * 1000;
/** After an attempt that did not finish cleanly (offline, signed out, a page failed), wait before retrying. */
export const WARM_RETRY_MS = 10 * 60 * 1000;

export const UPDATE_CHECK_MS = 5 * 60 * 1000;
/** Auto-reload for an update at most this often; after that, only offer the Reload link. Stops a reload loop. */
export const UPDATE_RELOAD_COOLDOWN_MS = 10 * 60 * 1000;

export type BannerState = { kind: 'offline' | 'stale' | 'session' | 'update'; text: string; actionHref?: string; actionLabel?: string };

export function formatAge(ms: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Save pages now? Never while offline; not again within WARM_RETRY_MS of any attempt; and not within WARM_EVERY_MS of
 * a clean run, unless a newer build has deployed since (`buildChanged`): then the saved pages and assets are out of date.
 */
export function shouldWarm(input: { now: number; online: boolean; lastOk: number; lastAttempt: number; buildChanged?: boolean; running?: boolean }): boolean {
  if (!input.online || input.running) return false;
  if (!input.buildChanged && input.now - input.lastOk < WARM_EVERY_MS) return false;
  if (input.now - input.lastAttempt < WARM_RETRY_MS) return false;
  return true;
}

export const OFFLINE_TEXT = 'Offline. Saved copies are shown where available. Photos still save to this phone; approvals, quotes and payments need a connection.';

// ---- updates -------------------------------------------------------------------------------------
// Every deploy stamps a new build id ("<epoch ms>-<commit>") into the internal pages (<meta name="cv-build">) and into
// the service worker file, so the browser installs the new worker on its own. A page that is older than the worker
// serving it is out of date.

export function buildTime(id: string | null | undefined): number | null {
  const m = /^(\d{10,})-/.exec(id || '');
  return m ? Number(m[1]) : null;
}

/** Short label for the screen: the commit part, or "dev". */
export function buildLabel(id: string | null | undefined): string {
  const m = /^\d{10,}-(.+)$/.exec(id || '');
  return m ? m[1] : 'dev';
}

/** The worker's build is newer than the page's. Ids that cannot be compared (dev builds) never count. */
export function pageIsStale(pageBuild: string | null | undefined, workerBuild: string | null | undefined): boolean {
  const page = buildTime(pageBuild);
  const worker = buildTime(workerBuild);
  return page !== null && worker !== null && worker > page;
}

export function shouldCheckForUpdate(input: { now: number; online: boolean; lastCheck: number }): boolean {
  return input.online && input.now - input.lastCheck >= UPDATE_CHECK_MS;
}

export type UpdateAction = 'none' | 'banner' | 'reload-now' | 'reload-on-resume';

/**
 * What to do about an out-of-date page. Never throw away work or loop: unsaved input, being offline (a reload would
 * serve the saved copy again) or a recent update reload all fall back to the Reload link. A hidden page reloads when
 * the app is next opened; a visible, clean one reloads now.
 */
export function updateAction(input: { stale: boolean; online: boolean; hidden: boolean; dirty: boolean; lastReloadAt: number; now: number }): UpdateAction {
  if (!input.stale) return 'none';
  if (input.dirty || !input.online || input.now - input.lastReloadAt < UPDATE_RELOAD_COOLDOWN_MS) return 'banner';
  return input.hidden ? 'reload-on-resume' : 'reload-now';
}

/** Which banner (if any) to show. Session ended outranks offline, then a ready update, then a saved copy. */
export function bannerFor(input: { sessionExpired: boolean; online: boolean; staleSince: number | null; path: string; now?: number; updateReady?: boolean }): BannerState | null {
  if (input.sessionExpired) {
    return { kind: 'session', text: 'Your session ended. Sign in again to load live data.', actionHref: `/internal/login?next=${encodeURIComponent(input.path)}`, actionLabel: 'Sign in' };
  }
  if (!input.online) return { kind: 'offline', text: OFFLINE_TEXT };
  if (input.updateReady) return { kind: 'update', text: 'A new version of the Command Center is ready.', actionHref: input.path, actionLabel: 'Reload' };
  if (input.staleSince !== null) {
    return { kind: 'stale', text: `Showing a saved copy from ${formatAge(input.staleSince, input.now)}. The connection is weak.`, actionHref: input.path, actionLabel: 'Reload' };
  }
  return null;
}
