// Companion Worker for jobs Pages Functions cannot do: anything on a schedule.
// Cron Triggers (see wrangler.toml):
//   "15 10 * * *"  nightly D1 backup to R2 (about 3:15 AM Pacific), then prune to the newest 30
//   "30 15 * * 1-5" weekday morning follow-up nudge (about 8:30 AM Pacific)
//
// It has no public surface: fetch() answers 404 to everything. Failures are pushed to the phone
// (ops channel, no customer data) so a broken backup is never silent.
import { runBackup, pruneBackups } from './backup.mjs';
import { countFollowUps, digestMessage, FOLLOW_UPS_URL } from './digest.mjs';
import { sendOpsAlert } from '../../../functions/_lib/lead-alert.mjs';

export const BACKUP_CRON = '15 10 * * *';
export const DIGEST_CRON = '30 15 * * 1-5';

export async function handleScheduled(cron, env, now = new Date(), alert = sendOpsAlert) {
  if (cron === BACKUP_CRON) {
    try {
      const result = await runBackup(env.QUOTES_DB, env.DB_BACKUPS, now);
      const pruned = await pruneBackups(env.DB_BACKUPS, now);
      console.log('backup-ok', JSON.stringify({ ...result, pruned: pruned.length }));
      return { job: 'backup', ok: true, ...result, pruned: pruned.length };
    } catch (error) {
      console.error('backup-failed', error?.message || error);
      await alert(env, { title: 'Database backup FAILED', body: 'Last night\'s backup did not complete. The live data is fine. Tell Keith.', click: 'https://windowsbyclearview.com/internal', tags: 'warning' });
      return { job: 'backup', ok: false, error: String(error?.message || error) };
    }
  }
  if (cron === DIGEST_CRON) {
    try {
      const counts = await countFollowUps(env.QUOTES_DB, now);
      const message = digestMessage(counts);
      if (!message) return { job: 'digest', ok: true, sent: false, ...counts };
      const sent = await alert(env, { ...message, click: FOLLOW_UPS_URL, tags: 'memo' });
      return { job: 'digest', ok: true, sent: sent.status === 'sent', ...counts };
    } catch (error) {
      console.error('digest-failed', error?.message || error);
      return { job: 'digest', ok: false, error: String(error?.message || error) };
    }
  }
  return { job: 'unknown', ok: false, error: `No job for cron "${cron}".` };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event.cron, env, new Date(event.scheduledTime)));
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
