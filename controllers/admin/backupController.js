const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, paginated, noContent } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const backupService = require('../../services/backupService');
const adminActionService = require('../../services/adminActionService');
const emailService = require('../../services/emailService');
const SuperAdmin = require('../../models/admin/SuperAdmin');

const list = asyncHandler(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const { items, total } = await backupService.listBackups({
    page,
    limit,
    status: req.query.status || null,
  });
  return paginated(res, items, page, limit, total);
});

const createNow = asyncHandler(async (req, res) => {
  const doc = await backupService.createBackup({
    type: 'manual',
    triggeredBy: req.admin.id,
  });

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'backup.run',
    metadata: { backupId: String(doc._id), filename: doc.filename },
    ip: req.ip,
  });

  return created(res, doc);
});

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'backupId');
  const doc = await backupService.getBackup(req.params.id);
  return ok(res, doc);
});

const download = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'backupId');
  const { url } = await backupService.getDownloadUrl(req.params.id);
  return ok(res, { url });
});

const sendEmail = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'backupId');
  const { to } = req.body;
  if (!to) throw ApiError.badRequest('EMAIL_REQUIRED', 'Recipient email required');

  try {
    const result = await backupService.sendBackupByEmail(req.params.id, to);

    await adminActionService.log({
      adminId: req.admin.id,
      action: 'backup.send_email',
      metadata: { backupId: req.params.id, to },
      ip: req.ip,
    });

    return ok(res, result);
  } catch (err) {
    const status = err.response?.status;
    if (status >= 500) {
      throw ApiError.unavailable('EMAIL_PROVIDER_ERROR', 'Email provider is temporarily unavailable. Try again shortly.');
    }
    if (status === 401 || status === 403) {
      throw ApiError.unavailable('EMAIL_AUTH_FAILED', 'Email provider authentication failed.');
    }
    throw err;
  }
});

const restore = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'backupId');

  const result = await backupService.restoreBackup(req.params.id, {
    confirm: req.body.confirm === true,
  });

  const admins = await SuperAdmin.find({ status: 'active' }).select('email').lean();
  for (const a of admins) {
    emailService
      .sendAdminRestoreComplete({
        to: a.email,
        recipientId: a._id,
        filename: result.restored,
        collections: result.collections,
        at: result.at,
      })
      .catch(() => {});
  }

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'backup.restore',
    metadata: { backupId: req.params.id, filename: result.restored },
    ip: req.ip,
  });

  return ok(res, result);
});

const remove = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'backupId');
  await backupService.deleteBackup(req.params.id);

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'backup.delete',
    metadata: { backupId: req.params.id },
    ip: req.ip,
  });

  return noContent(res);
});

const getSettings = asyncHandler(async (_req, res) => {
  const settings = await backupService.getSettings();
  return ok(res, settings);
});

const updateSettings = asyncHandler(async (req, res) => {
  const settings = await backupService.updateSettings(req.body, req.admin.id);

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'backup.settings.update',
    metadata: { keys: Object.keys(req.body || {}) },
    ip: req.ip,
  });

  return ok(res, settings);
});

module.exports = {
  list,
  createNow,
  get,
  download,
  sendEmail,
  restore,
  remove,
  getSettings,
  updateSettings,
};