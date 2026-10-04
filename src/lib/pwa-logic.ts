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

// ---- photo backup status and diagnostics text ------------------------------------------------------

export type PhotoBackup = {
  /** Is the R2 binding present on the server? null when it could not be asked (offline, signed out). */
  configured: boolean | null;
  /** Photos in cloud storage; null when unknown. */
  backedUp: number | null;
  /** Photos held by this browser, and how many of those have no cloud copy yet. */
  total: number;
  waiting: number;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line for Tools > Phone app, with a tone for the tick/dash. Photos are the one thing that exists only on the phone. */
export function photoBackupLine(p: PhotoBackup): { ok: boolean | null; text: string } {
  if (p.configured === null) {
    return { ok: null, text: p.total > 0 ? `Photo backup status unknown (offline or signed out). ${plural(p.total, 'photo')} on this phone.` : 'Photo backup status unknown (offline or signed out).' };
  }
  if (!p.configured) {
    return { ok: false, text: p.total > 0 ? `Cloud photo backup is NOT connected: the ${plural(p.total, 'photo')} on this phone ${p.total === 1 ? 'exists' : 'exist'} only here.` : 'Cloud photo backup is not connected yet. Photos you take will exist only on this phone.' };
  }
  if (p.waiting > 0) return { ok: false, text: `Cloud photo backup is on, but ${plural(p.waiting, 'photo')} on this phone ${p.waiting === 1 ? 'is' : 'are'} not backed up yet. They upload when you have signal.` };
  return { ok: true, text: `Cloud photo backup is on${p.backedUp !== null ? ` (${plural(p.backedUp, 'photo')} backed up)` : ''}. Nothing on this phone is waiting.` };
}

export type DiagnosticsInput = {
  now: number;
  pageBuild: string;
  workerBuild: string | null;
  supported: boolean;
  controlled: boolean;
  standalone: boolean;
  ios: boolean;
  online: boolean;
  persisted: boolean | null;
  userAgent: string;
  worker: { version: string; pages: number; assets: number; data: number; newestDataAt: number | null; warm: { okAt?: number; okBuild?: string; attemptAt?: number; attemptBuild?: string; running?: boolean }; log: { at: string; kind: string; detail: string }[] } | null;
  photos: PhotoBackup;
};

const yesNo = (v: boolean | null) => (v === null ? 'unknown' : v ? 'yes' : 'no');
const when = (ms: number | undefined | null, now: number) => (ms ? `${new Date(ms).toISOString()} (${formatAge(ms, now)})` : 'never');

/**
 * Plain text a person can paste into a message. Only versions, switches, counts and event kinds: no customer data,
 * no job ids, no query strings (the worker already strips them from its log).
 */
export function diagnosticsText(d: DiagnosticsInput): string {
  const lines = [
    'Clearview Command Center diagnostics',
    `taken ${new Date(d.now).toISOString()}`,
    `page build ${d.pageBuild} (${buildLabel(d.pageBuild)}) | worker build ${d.workerBuild ?? 'not running'} (${buildLabel(d.workerBuild)})${d.workerBuild && d.workerBuild !== d.pageBuild ? ' | MISMATCH' : ''}`,
    `installed app ${yesNo(d.standalone)} | iOS ${yesNo(d.ios)} | online ${yesNo(d.online)} | offline support available ${yesNo(d.supported)} | page controlled by worker ${yesNo(d.controlled)} | storage protected ${yesNo(d.persisted)}`,
    `browser ${d.userAgent}`,
  ];
  if (d.worker) {
    const w = d.worker;
    lines.push(`saved: ${plural(w.pages, 'page')}, ${plural(w.assets, 'asset')}, ${plural(w.data, 'data entry').replace('entrys', 'entries')}; newest data ${when(w.newestDataAt, d.now)}`);
    lines.push(`last clean warm-up ${when(w.warm.okAt, d.now)} for build ${w.warm.okBuild ?? 'none'} | last unfinished attempt ${w.warm.attemptAt ? when(w.warm.attemptAt, d.now) : 'none'} | running ${yesNo(!!w.warm.running)}`);
  } else {
    lines.push('worker: no answer (not running yet, or offline support is unavailable)');
  }
  lines.push(`photos: ${photoBackupLine(d.photos).text}`);
  const log = d.worker?.log ?? [];
  lines.push(log.length ? 'recent worker events (oldest first):' : 'recent worker events: none');
  for (const e of log) lines.push(`  ${e.at} ${e.kind}${e.detail ? ' ' + e.detail : ''}`);
  return lines.join('\n');
}

