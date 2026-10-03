/**
 * Pure decisions behind the Command Center PWA client (src/scripts/internal-pwa.ts), kept free of
 * the DOM so `npm run test:internal-pwa` can run them. Contract: .ai/references/internal-pwa.md.
 */

export const WARM_EVERY_MS = 6 * 60 * 60 * 1000;
/** After an attempt that did not finish cleanly (offline, signed out, a page failed), wait before retrying. */
export const WARM_RETRY_MS = 10 * 60 * 1000;

export type BannerState = { kind: 'offline' | 'stale' | 'session'; text: string; actionHref?: string; actionLabel?: string };

export function formatAge(ms: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Save pages now? Never while offline; not again within WARM_EVERY_MS of a clean run or WARM_RETRY_MS of any attempt. */
export function shouldWarm(input: { now: number; online: boolean; lastOk: number; lastAttempt: number }): boolean {
  if (!input.online) return false;
  if (input.now - input.lastOk < WARM_EVERY_MS) return false;
  if (input.now - input.lastAttempt < WARM_RETRY_MS) return false;
  return true;
}

export const OFFLINE_TEXT = 'Offline. Saved copies are shown where available. Photos still save to this phone; approvals, quotes and payments need a connection.';

/** Which banner (if any) to show. Session ended outranks offline, which outranks a saved copy. */
export function bannerFor(input: { sessionExpired: boolean; online: boolean; staleSince: number | null; path: string; now?: number }): BannerState | null {
  if (input.sessionExpired) {
    return { kind: 'session', text: 'Your session ended. Sign in again to load live data.', actionHref: `/internal/login?next=${encodeURIComponent(input.path)}`, actionLabel: 'Sign in' };
  }
  if (!input.online) return { kind: 'offline', text: OFFLINE_TEXT };
  if (input.staleSince !== null) {
    return { kind: 'stale', text: `Showing a saved copy from ${formatAge(input.staleSince, input.now)}. The connection is weak.`, actionHref: input.path, actionLabel: 'Reload' };
  }
  return null;
}
