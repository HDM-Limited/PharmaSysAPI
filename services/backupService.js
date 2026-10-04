const crypto = require('crypto');
const zlib = require('zlib');
const mongoose = require('mongoose');
const Backup = require('../models/admin/Backup');
const settingsService = require('./settingsService');
const emailService = require('./emailService');
const { uploadBuffer, destroy, FOLDERS, enabled: cloudinaryEnabled } = require('../config/cloudinary');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');

/* ═══════════════════════════════════════════════════════════
   DUMP — pure Node, reads every collection via Mongoose
   ═══════════════════════════════════════════════════════════ */

async function dumpDatabase({ collections = [] } = {}) {
  const db = mongoose.connection.db;
  if (!db) throw new Error('DB_NOT_CONNECTED');

  const all = await db.listCollections().toArray();
  const names = collections.length
    ? all.filter((c) => collections.includes(c.name)).map((c) => c.name)
    : all.map((c) => c.name);

  const dump = {
    version: 1,
    createdAt: new Date().toISOString(),
    database: db.databaseName,
    collections: {},
    counts: {},
  };

  for (const name of names) {
    try {
      const docs = await db.collection(name).find({}).toArray();
      dump.collections[name] = docs;
      dump.counts[name] = docs.length;
    } catch (err) {
      logger.warn({ err: err.message, collection: name }, 'backup: collection read failed');
    }
  }

  return dump;
}

function serialize(dump) {
  return Buffer.from(JSON.stringify(dump));
}

function gzip(buffer) {
  return zlib.gzipSync(buffer, { level: 6 });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════════ */

async function getSettings() {
  return settingsService.getBackupConfig();
}

async function updateSettings(patch, adminId = null) {
  const updates = {};
  for (const [k, v] of Object.entries(patch || {})) updates[k] = v;
  return settingsService.setMany(updates, adminId);
}

/* ═══════════════════════════════════════════════════════════
   CREATE BACKUP
   ═══════════════════════════════════════════════════════════ */

async function createBackup({ type = 'auto', triggeredBy = null } = {}) {
  const cfg = await getSettings();
  if (!cfg.backup_enabled) throw new Error('BACKUPS_DISABLED');
  if (!cloudinaryEnabled) throw new Error('CLOUDINARY_NOT_CONFIGURED');

  const startedAt = new Date();
  const filename = `pharmasys-backup-${startedAt.toISOString().replace(/[:.]/g, '-')}.json.gz`;

  const backup = await Backup.create({
    filename,
    type,
    status: 'running',
    startedAt,
    triggeredBy,
    retentionUntil: cfg.backup_retention_days
      ? new Date(startedAt.getTime() + cfg.backup_retention_days * 86400000)
      : null,
  });

  try {
    const dump = await dumpDatabase({ collections: cfg.backup_collections || [] });
    const json = serialize(dump);
    const gz = gzip(json);
    const checksum = sha256(gz);

    const uploaded = await uploadBuffer(gz, {
      folder: FOLDERS.backups(),
      publicId: filename,
      resourceType: 'raw',
    });

    const durationMs = Date.now() - startedAt.getTime();

    backup.publicId = uploaded.publicId;
    backup.url = uploaded.url;
    backup.sizeBytes = gz.length;
    backup.checksum = checksum;
    backup.status = 'success';
    backup.completedAt = new Date();
    backup.durationMs = durationMs;
    backup.collections = Object.keys(dump.collections);
    backup.recordCounts = dump.counts;
    await backup.save();

    if (cfg.backup_notify_on_success) {
      const recipients = cfg.backup_notify_emails || [];
      for (const email of recipients) {
        emailService
          .sendAdminBackupSuccess({
            to: email,
            filename,
            sizeHuman: formatBytes(gz.length),
            durationMs,
            collections: Object.keys(dump.collections),
            at: backup.completedAt.toISOString(),
            downloadUrl: uploaded.url,
          })
          .catch(() => {});
      }
    }

    logger.info({ filename, bytes: gz.length, durationMs, collections: backup.collections.length }, 'backup completed');
    return backup;
  } catch (err) {
    backup.status = 'failed';
    backup.error = err.message;
    backup.completedAt = new Date();
    backup.durationMs = Date.now() - startedAt.getTime();
    await backup.save();

    if (cfg.backup_notify_on_fail) {
      const recipients = cfg.backup_notify_emails || [];
      for (const email of recipients) {
        emailService
          .sendAdminBackupFailed({ to: email, error: err.message, at: backup.completedAt.toISOString() })
          .catch(() => {});
      }
    }

    logger.error({ err: err.message, filename }, 'backup failed');
    throw err;
  }
}

/* ═══════════════════════════════════════════════════════════
   RESTORE — pure Node, reads JSON.gz from Cloudinary
   ═══════════════════════════════════════════════════════════ */

async function downloadBuffer(url) {
  const https = require('https');
  const http = require('http');

  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function restoreBackup(id, { confirm = false } = {}) {
  if (!confirm) throw new Error('RESTORE_NOT_CONFIRMED');

  const doc = await Backup.findById(id).lean();
  if (!doc) throw new Error('BACKUP_NOT_FOUND');
  if (!doc.url) throw new Error('BACKUP_HAS_NO_URL');

  const gz = await downloadBuffer(doc.url);
  const json = zlib.gunzipSync(gz);
  const dump = JSON.parse(json.toString('utf8'));

  if (!dump.collections) throw new Error('INVALID_BACKUP_FORMAT');

  const db = mongoose.connection.db;
  const restored = [];

  for (const [name, docs] of Object.entries(dump.collections)) {
    if (!Array.isArray(docs)) continue;
    try {
      await db.collection(name).deleteMany({});
      if (docs.length) await db.collection(name).insertMany(docs);
      restored.push(name);
    } catch (err) {
      logger.warn({ err: err.message, collection: name }, 'restore: collection failed');
    }
  }

  logger.info({ collections: restored.length, filename: doc.filename }, 'restore completed');

  return {
    restored: doc.filename,
    collections: restored,
    at: new Date().toISOString(),
  };
}

/* ═══════════════════════════════════════════════════════════
   LIST / GET / DELETE / PRUNE / EMAIL
   ═══════════════════════════════════════════════════════════ */

async function listBackups({ page = 1, limit = 20, status = null } = {}) {
  const filter = {};
  if (status) filter.status = status;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Backup.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit).lean(),
    Backup.countDocuments(filter),
  ]);

  return { items, total, page, limit };
}

async function getBackup(id) {
  const doc = await Backup.findById(id).lean();
  if (!doc) throw new Error('BACKUP_NOT_FOUND');
  return doc;
}

async function getDownloadUrl(id) {
  const doc = await Backup.findById(id).lean();
  if (!doc) throw new Error('BACKUP_NOT_FOUND');
  if (!doc.url) throw new Error('BACKUP_HAS_NO_URL');
  return { url: doc.url };
}

async function sendBackupByEmail(id, to) {
  const doc = await Backup.findById(id).lean();
  if (!doc) throw new Error('BACKUP_NOT_FOUND');
  if (!doc.url) throw new Error('BACKUP_HAS_NO_URL');
  if (!to) throw new Error('EMAIL_REQUIRED');

  await emailService.sendGeneric({
    to,
    subject: `PharmaSys backup — ${doc.filename}`,
    html: `
      <p>Backup <strong>${doc.filename}</strong> is ready.</p>
      <p>Size: ${formatBytes(doc.sizeBytes)}</p>
      <p><a href="${doc.url}">Download</a></p>
    `,
    text: `Backup ${doc.filename} ready. Size: ${formatBytes(doc.sizeBytes)}. Download: ${doc.url}`,
    template: 'backup_link',
  });

  return { sent: true, to };
}

async function deleteBackup(id) {
  const doc = await Backup.findById(id);
  if (!doc) throw new Error('BACKUP_NOT_FOUND');
  if (doc.publicId) await destroy(doc.publicId, 'raw').catch(() => {});
  await doc.deleteOne();
  return { deleted: true };
}

async function prune() {
  const cfg = await getSettings();
  const retentionDays = cfg.backup_retention_days || 30;
  const cutoff = new Date(Date.now() - retentionDays * 86400000);

  const stale = await Backup.find({ status: 'success', completedAt: { $lt: cutoff } }).lean();
  let deleted = 0;
  for (const b of stale) {
    try {
      if (b.publicId) await destroy(b.publicId, 'raw');
      await Backup.deleteOne({ _id: b._id });
      deleted++;
    } catch (err) {
      logger.warn({ err: err.message, filename: b.filename }, 'backup prune failed');
    }
  }
  return { deleted };
}

/* ═══════════════════════════════════════════════════════════ */

module.exports = {
  getSettings,
  updateSettings,
  createBackup,
  listBackups,
  getBackup,
  getDownloadUrl,
  sendBackupByEmail,
  restoreBackup,
  deleteBackup,
  prune,
  formatBytes,
  dumpDatabase,
};