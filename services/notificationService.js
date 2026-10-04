const AppNotification = require('../models/client/AppNotification');
const User = require('../models/client/User');
const { emitToUser } = require('../config/socket');
const { logger } = require('../utils/logger');

async function create({ tenantId, userId, branchId = null, type = 'info', title, body = null, icon = null, link = null, meta = {}, expiresAt = null }) {
  if (!userId) throw new Error('notificationService.create: userId required');
  if (!title) throw new Error('notificationService.create: title required');

  const notification = await AppNotification.create({
    tenantId,
    userId,
    branchId,
    type,
    title,
    body,
    icon,
    link,
    meta,
    expiresAt,
  });

  try {
    emitToUser(String(userId), 'notification:new', notification.toObject());
  } catch (err) {
    logger.warn({ err: err.message }, 'notification emit failed');
  }

  return notification;
}

async function createMany({ userIds = [], ...payload }) {
  const results = await Promise.all(
    userIds.map((userId) => create({ ...payload, userId }).catch((e) => {
      logger.warn({ err: e.message, userId: String(userId) }, 'notification create failed');
      return null;
    }))
  );
  return results.filter(Boolean);
}

async function list({ tenantId, userId, filter = {}, skip = 0, limit = 20 }) {
  const q = { tenantId, userId, ...filter };
  const [items, total] = await Promise.all([
    AppNotification.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AppNotification.countDocuments(q),
  ]);
  return { items, total };
}

async function unreadCount({ tenantId, userId }) {
  return AppNotification.countDocuments({ tenantId, userId, readAt: null });
}

async function markRead({ tenantId, userId, notificationId }) {
  return AppNotification.updateOne(
    { _id: notificationId, tenantId, userId },
    { $set: { readAt: new Date(), seen: true } }
  );
}

async function markAllRead({ tenantId, userId }) {
  return AppNotification.updateMany(
    { tenantId, userId, readAt: null },
    { $set: { readAt: new Date(), seen: true } }
  );
}

async function remove({ tenantId, userId, notificationId }) {
  return AppNotification.deleteOne({ _id: notificationId, tenantId, userId });
}

async function clear({ tenantId, userId }) {
  return AppNotification.deleteMany({ tenantId, userId, readAt: { $ne: null } });
}

/* ─── Event shortcuts (used by controllers/services) ─── */

async function notifyOwner({ tenantId, title, body, type = 'info', icon = null, link = null, meta = {}, branchId = null }) {
  const owners = await User.find({ tenantId, role: 'owner', status: 'active' }).select('_id').lean();
  return createMany({
    tenantId,
    userIds: owners.map((o) => o._id),
    branchId,
    type,
    title,
    body,
    icon,
    link,
    meta,
  });
}

async function notifyBranchManagers({ tenantId, branchId, title, body, type = 'info', icon = null, link = null, meta = {} }) {
  const managers = await User.find({
    tenantId,
    role: 'branch_manager',
    status: 'active',
    branchIds: branchId,
  }).select('_id').lean();

  return createMany({
    tenantId,
    userIds: managers.map((m) => m._id),
    branchId,
    type,
    title,
    body,
    icon,
    link,
    meta,
  });
}

async function notifyBranchUsers({ tenantId, branchId, title, body, type = 'info', icon = null, link = null, meta = {} }) {
  const users = await User.find({
    tenantId,
    status: 'active',
    $or: [{ branchIds: branchId }, { role: 'owner' }],
  }).select('_id').lean();

  return createMany({
    tenantId,
    userIds: users.map((u) => u._id),
    branchId,
    type,
    title,
    body,
    icon,
    link,
    meta,
  });
}

/* ─── Named events used across the app ─── */

async function notifySaleCompleted({ tenantId, branchId, sale }) {
  return notifyBranchManagers({
    tenantId,
    branchId,
    type: 'sale',
    title: 'New sale',
    body: `Invoice ${sale.invoiceNo} — ${sale.grandTotal}`,
    icon: 'receipt',
    link: `/app/sales/${sale._id}`,
    meta: { saleId: String(sale._id), amount: sale.grandTotal },
  });
}

async function notifyLowStock({ tenantId, branchId, drug, qty }) {
  return notifyBranchManagers({
    tenantId,
    branchId,
    type: 'inventory',
    title: 'Low stock',
    body: `${drug.name} is down to ${qty}`,
    icon: 'alert',
    link: `/app/inventory/${drug._id}`,
    meta: { drugId: String(drug._id), qty },
  });
}

async function notifyExpiring({ tenantId, branchId, count, daysLeft }) {
  return notifyBranchManagers({
    tenantId,
    branchId,
    type: 'warning',
    title: `Expiring in ${daysLeft} days`,
    body: `${count} batch${count === 1 ? '' : 'es'} approaching expiry`,
    icon: 'clock',
    link: '/app/inventory/expiring',
    meta: { count, daysLeft },
  });
}

async function notifyPrescriptionReady({ tenantId, branchId, prescription }) {
  return notifyBranchManagers({
    tenantId,
    branchId,
    type: 'prescription',
    title: 'Prescription dispensed',
    body: `Ref ${prescription.refNo} is ready`,
    icon: 'pill',
    link: `/app/prescriptions/${prescription._id}`,
    meta: { prescriptionId: String(prescription._id) },
  });
}

async function notifySubscriptionEvent({ tenantId, title, body, type = 'info', meta = {} }) {
  return notifyOwner({ tenantId, title, body, type, icon: 'card', link: '/app/billing', meta });
}

module.exports = {
  create,
  createMany,
  list,
  unreadCount,
  markRead,
  markAllRead,
  remove,
  clear,

  notifyOwner,
  notifyBranchManagers,
  notifyBranchUsers,

  notifySaleCompleted,
  notifyLowStock,
  notifyExpiring,
  notifyPrescriptionReady,
  notifySubscriptionEvent,
};