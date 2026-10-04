const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, paginated, noContent } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const AppNotification = require('../../models/client/AppNotification');

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { tenantId: req.tenantId, userId: req.user._id };
  if (req.query.unread === 'true') filter.readAt = null;

  const [items, total] = await Promise.all([
    AppNotification.find({ __allowGlobal: true, ...filter })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AppNotification.countDocuments({ __allowGlobal: true, ...filter }),
  ]);

  return paginated(res, items, page, limit, total);
});

const unread = asyncHandler(async (req, res) => {
  const count = await AppNotification.countDocuments({
    __allowGlobal: true,
    tenantId: req.tenantId,
    userId: req.user._id,
    readAt: null,
  });
  return ok(res, { count });
});

const markRead = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'notificationId');
  const result = await AppNotification.updateOne(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId, userId: req.user._id },
    { $set: { readAt: new Date(), seen: true } }
  );
  if (result.matchedCount === 0) throw ApiError.notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  return ok(res, { read: true });
});

const markAllRead = asyncHandler(async (req, res) => {
  const result = await AppNotification.updateMany(
    { __allowGlobal: true, tenantId: req.tenantId, userId: req.user._id, readAt: null },
    { $set: { readAt: new Date(), seen: true } }
  );
  return ok(res, { modified: result.modifiedCount });
});

const remove = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'notificationId');
  await AppNotification.deleteOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
    userId: req.user._id,
  });
  return noContent(res);
});

const clear = asyncHandler(async (req, res) => {
  const result = await AppNotification.deleteMany({
    __allowGlobal: true,
    tenantId: req.tenantId,
    userId: req.user._id,
    readAt: { $ne: null },
  });
  return ok(res, { deleted: result.deletedCount });
});

module.exports = { list, unread, markRead, markAllRead, remove, clear };