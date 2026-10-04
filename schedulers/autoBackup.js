const cron = require('node-cron');
const Backup = require('../models/admin/Backup');
const settingsService = require('../services/settingsService');
const backupService = require('../services/backupService');
const { logger } = require('../utils/logger');

const TZ = process.env.SCHEDULERS_TIMEZONE || 'Africa/Nairobi';

let tickTask = null;
let pruneTask = null;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ─────────── settings-driven scheduling ─────────── */

/**
 * Convert backup_time + backup_frequency into a cron expression.
 *   daily    → "MM HH * * *"
 *   weekly   → "MM HH * * DOW"
 *   monthly  → "MM HH 1 * *"  (1st of month)
 */
function cronFromSettings(cfg) {
  const time = String(cfg.backup_time || '03:00');
  const [hh, mm] = time.split(':').map((s) => parseInt(s, 10));
  const hour = Number.isFinite(hh) ? hh : 3;
  const minute = Number.isFinite(mm) ? mm : 0;
  const freq = String(cfg.backup_frequency || 'daily').toLowerCase();
  const dow = Number.isFinite(cfg.backup_day_of_week) ? cfg.backup_day_of_week : 0;

  if (freq === 'weekly') return `${minute} ${hour} * * ${dow}`;
  if (freq === 'monthly') return `${minute} ${hour} 1 * *`;
  return `${minute} ${hour} * * *`;
}

/**
 * Compute next run time from a cron expression.
 * We don't use a library here — we approximate with a simple
 * day/week/month advance in the scheduler timezone.
 */
function computeNextRun(cfg) {
  const now = new Date();
  const [hh, mm] = String(cfg.backup_time || '03:00')
    .split(':')
    .map((s) => parseInt(s, 10));
  const hour = Number.isFinite(hh) ? hh : 3;
  const minute = Number.isFinite(mm) ? mm : 0;
  const freq = String(cfg.backup_frequency || 'daily').toLowerCase();
  const dow = Number.isFinite(cfg.backup_day_of_week) ? cfg.backup_day_of_week : 0;

  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);

  if (next <= now) {
    if (freq === 'weekly') next.setDate(next.getDate() + 7);
    else if (freq === 'monthly') next.setMonth(next.getMonth() + 1, 1);
    else next.setDate(next.getDate() + 1);
  }

  // If weekly, advance to the right day of week
  if (freq === 'weekly') {
    while (next.getDay() !== dow) next.setDate(next.getDate() + 1);
  }

  return next;
}

/* ─────────── backup run ─────────── */

async function run() {
  const cfg = await settingsService.getBackupConfig();

  if (!cfg.backup_enabled) {
    logger.info('auto backup skipped — backups disabled');
    return { skipped: true, reason: 'disabled' };
  }
  if (!cfg.backup_auto_enabled) {
    logger.info('auto backup skipped — auto backups disabled');
    return { skipped: true, reason: 'auto_disabled' };
  }

  /* Dedupe: skip if a successful auto backup already ran today */
  const today = startOfToday();
  const existing = await Backup.findOne({
    type: 'auto',
    status: 'success',
    startedAt: { $gte: today },
  })
    .select('_id filename')
    .lean();

  if (existing) {
    logger.info(
      { filename: existing.filename },
      'auto backup skipped — already ran today'
    );
    return { skipped: true, filename: existing.filename };
  }

  /* Retry loop honoring backup_retry_on_failure + backup_max_retries */
  const shouldRetry = cfg.backup_retry_on_failure !== false;
  const maxRetries = Number.isFinite(cfg.backup_max_retries)
    ? cfg.backup_max_retries
    : 2;
  const attempts = shouldRetry ? maxRetries + 1 : 1;

  let lastErr = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const backup = await backupService.createBackup({ type: 'auto' });

      // Record last run status
      await settingsService.setMany(
        {
          backup_last_run_at: new Date().toISOString(),
          backup_last_status: 'success',
          backup_next_run_at: computeNextRun(cfg).toISOString(),
        },
        null
      );

      logger.info(
        { filename: backup.filename, bytes: backup.sizeBytes, attempt: i + 1 },
        'auto backup complete'
      );
      return { filename: backup.filename, attempts: i + 1 };
    } catch (err) {
      lastErr = err;
      logger.warn(
        { err: err.message, attempt: i + 1, max: attempts },
        'auto backup attempt failed'
      );
      if (i < attempts - 1) {
        // small backoff between retries
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      }
    }
  }

  await settingsService.setMany(
    {
      backup_last_run_at: new Date().toISOString(),
      backup_last_status: 'failed',
      backup_next_run_at: computeNextRun(cfg).toISOString(),
    },
    null
  );

  logger.error({ err: lastErr?.message }, 'auto backup failed after retries');
  throw lastErr;
}

/* ─────────── prune ─────────── */

async function prune() {
  try {
    const result = await backupService.prune();
    logger.info({ deleted: result.deleted }, 'backup prune complete');
    return result;
  } catch (err) {
    logger.warn({ err: err.message }, 'backup prune failed');
    return { deleted: 0 };
  }
}

/* ─────────── start / stop ─────────── */

/**
 * We don't hardcode a cron expression. Instead we tick once a minute
 * and, on each tick, ask: "is it time to run the backup?"
 *
 * This way changing backup_time / backup_frequency in the admin panel
 * takes effect on the next tick without needing a server restart.
 */
async function tick() {
  try {
    const cfg = await settingsService.getBackupConfig();

    if (!cfg.backup_enabled || !cfg.backup_auto_enabled) return;

    const now = new Date();
    const [hh, mm] = String(cfg.backup_time || '03:00')
      .split(':')
      .map((s) => parseInt(s, 10));
    const hour = Number.isFinite(hh) ? hh : 3;
    const minute = Number.isFinite(mm) ? mm : 0;
    const freq = String(cfg.backup_frequency || 'daily').toLowerCase();
    const dow = Number.isFinite(cfg.backup_day_of_week) ? cfg.backup_day_of_week : 0;

    // Only fire within the same minute as the target time
    if (now.getHours() !== hour || now.getMinutes() !== minute) return;

    // For weekly, also require matching day of week
    if (freq === 'weekly' && now.getDay() !== dow) return;

    // For monthly, require day 1
    if (freq === 'monthly' && now.getDate() !== 1) return;

    // It's time — run
    await run();
  } catch (err) {
    logger.error({ err: err.message }, 'auto backup tick failed');
  }
}

function start() {
  // Tick every minute; the tick itself decides whether to run
  tickTask = cron.schedule(
    '* * * * *',
    () => {
      tick().catch(() => {});
    },
    { timezone: TZ }
  );

  // Prune daily at 02:00 regardless of backup schedule
  pruneTask = cron.schedule(
    '0 2 * * *',
    () => {
      prune().catch(() => {});
    },
    { timezone: TZ }
  );

  logger.info('auto-backup scheduler started (settings-driven, ticking every minute)');
}

function stop() {
  tickTask?.stop();
  pruneTask?.stop();
}

module.exports = { name: 'autoBackup', start, stop, run, prune, tick };