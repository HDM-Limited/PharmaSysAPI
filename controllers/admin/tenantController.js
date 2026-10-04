const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const { signAccessToken } = require('../../utils/jwt');
const { env } = require('../../config/env');

const Tenant = require('../../models/admin/Tenant');
const User = require('../../models/client/User');
const Branch = require('../../models/client/Branch');
const Invoice = require('../../models/client/Invoice');
const Payment = require('../../models/client/Payment');
const Subscription = require('../../models/admin/Subscription');
const PendingActivation = require('../../models/admin/PendingActivation');
const Plan = require('../../models/admin/Plan');
const AdminAction = require('../../models/admin/AdminAction');
const { Drug, Batch, StockMovement } = require('../../models/client/Inventory');
const Customer = require('../../models/client/Customer');
const Patient = require('../../models/client/Patient');
const Prescription = require('../../models/client/Prescription');
const Sale = require('../../models/client/Sale');
const Supplier = require('../../models/client/Supplier');
const PurchaseOrder = require('../../models/client/PurchaseOrder');
const Notification = require('../../models/client/Notification');
const AppNotification = require('../../models/client/AppNotification');
const { AiInsight, AiCall } = require('../../models/client/Ai');
const emailService = require('../../services/emailService');

/* ─────────────── LIST ─────────────── */

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, country, search } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (country) filter.country = country;
  if (search) filter.name = { $regex: search, $options: 'i' };

  const [items, total] = await Promise.all([
    Tenant.find(filter).sort({ registeredAt: -1 }).skip(skip).limit(limit).lean(),
    Tenant.countDocuments(filter),
  ]);

  return paginated(res, items, page, limit, total);
});

/* ─────────────── GET ONE ─────────────── */

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const tenant = await Tenant.findById(req.params.id).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const tenantId = tenant._id;

  const [
    owner,
    pending,
    drugCount,
    customerCount,
    saleCount,
    staffCount,
    staffByRole,
    salesAggregate,
    lastSale,
    invoiceCount,
    paidInvoiceCount,
  ] = await Promise.all([
    User.findOne({ __allowGlobal: true, tenantId, role: 'owner' })
      .select('fullName email phone status')
      .lean(),
    PendingActivation.findOne({ tenantId }).lean(),
    Drug.countDocuments({ __allowGlobal: true, tenantId, isActive: true }),
    Customer.countDocuments({ __allowGlobal: true, tenantId, isActive: true }),
    Sale.countDocuments({ __allowGlobal: true, tenantId, status: { $ne: 'voided' } }),
    User.countDocuments({ __allowGlobal: true, tenantId, status: 'active' }),
    User.aggregate([
      { $match: { tenantId, status: 'active' } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
    Sale.aggregate([
      { $match: { tenantId, status: { $ne: 'voided' } } },
      { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
    ]),
    Sale.findOne({ __allowGlobal: true, tenantId, status: { $ne: 'voided' } })
      .sort({ createdAt: -1 })
      .select('invoiceNo grandTotal currency createdAt')
      .lean(),
    Invoice.countDocuments({ __allowGlobal: true, tenantId }),
    Invoice.countDocuments({ __allowGlobal: true, tenantId, status: 'paid' }),
  ]);

  const roleMap = Object.fromEntries(staffByRole.map((r) => [r._id, r.count]));
  const salesSum = salesAggregate[0] || { total: 0, count: 0 };

  return ok(res, {
    tenant,
    owner,
    pending,
    counts: {
      drugs: drugCount,
      customers: customerCount,
      sales: saleCount,
      staff: staffCount,
    },
    staffByRole: {
      owners: roleMap.owner || 0,
      managers: roleMap.branch_manager || 0,
      cashiers: roleMap.cashier || 0,
    },
    salesSummary: {
      total: salesSum.total,
      count: salesSum.count,
      currency: 'KES',
    },
    lastSale: lastSale || null,
    invoices: {
      total: invoiceCount,
      paid: paidInvoiceCount,
    },
  });
});

/* ─────────────── UPDATE ─────────────── */

const update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const allowed = ['name', 'country', 'planCode'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  if (patch.planCode) {
    const plan = await Plan.findOne({ code: patch.planCode }).lean();
    if (!plan) throw ApiError.badRequest('INVALID_PLAN', `Plan '${patch.planCode}' not found`);
  }

  const tenant = await Tenant.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'tenant.update',
    metadata: patch,
    ip: req.ip,
  }).catch(() => {});

  return ok(res, tenant);
});

/* ─────────────── SUSPEND ─────────────── */

const suspend = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  tenant.status = 'suspended';
  tenant.suspendedAt = new Date();
  tenant.suspendedBy = req.admin.id;
  tenant.suspendedReason = req.body.reason || null;
  await tenant.save();

  await User.updateMany(
    { __allowGlobal: true, tenantId: tenant._id },
    { $set: { status: 'suspended' } }
  );

  const owner = await User.findOne({
    __allowGlobal: true,
    tenantId: tenant._id,
    role: 'owner',
  }).lean();

  if (owner?.email) {
    emailService
      .sendStaffDeactivated({
        tenantId: tenant._id,
        to: owner.email,
        fullName: owner.fullName,
        businessName: tenant.name,
      })
      .catch(() => {});
  }

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'tenant.suspend',
    reason: req.body.reason || null,
    ip: req.ip,
  }).catch(() => {});

  return ok(res, { suspended: true });
});

/* ─────────────── REACTIVATE ─────────────── */

const reactivate = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  tenant.status = 'active';
  tenant.suspendedAt = null;
  tenant.suspendedBy = null;
  tenant.suspendedReason = null;
  await tenant.save();

  await User.updateMany(
    { __allowGlobal: true, tenantId: tenant._id, status: 'suspended' },
    { $set: { status: 'active' } }
  );

  const owner = await User.findOne({
    __allowGlobal: true,
    tenantId: tenant._id,
    role: 'owner',
  }).lean();

  if (owner?.email) {
    emailService
      .sendTenantReactivated({
        tenantId: tenant._id,
        to: owner.email,
        fullName: owner.fullName,
        businessName: tenant.name,
        loginUrl: `${env.appUrl}/login`,
      })
      .catch(() => {});
  }

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'tenant.reactivate',
    ip: req.ip,
  }).catch(() => {});

  return ok(res, { reactivated: true });
});

/* ─────────────── STATS (pre-delete preview) ─────────────── */

async function collectStats(tenantId) {
  const [
    drugs,
    branches,
    owners,
    managers,
    cashiers,
    otherStaff,
    sales,
    customers,
    patients,
    prescriptions,
    suppliers,
    purchaseOrders,
    invoices,
    payments,
    notifications,
    aiInsights,
    aiCalls,
  ] = await Promise.all([
    Drug.countDocuments({ __allowGlobal: true, tenantId }),
    Branch.countDocuments({ __allowGlobal: true, tenantId }),
    User.countDocuments({ __allowGlobal: true, tenantId, role: 'owner' }),
    User.countDocuments({ __allowGlobal: true, tenantId, role: 'branch_manager' }),
    User.countDocuments({ __allowGlobal: true, tenantId, role: 'cashier' }),
    User.countDocuments({
      __allowGlobal: true,
      tenantId,
      role: { $nin: ['owner', 'branch_manager', 'cashier'] },
    }),
    Sale.countDocuments({ __allowGlobal: true, tenantId }),
    Customer.countDocuments({ __allowGlobal: true, tenantId }),
    Patient.countDocuments({ __allowGlobal: true, tenantId }),
    Prescription.countDocuments({ __allowGlobal: true, tenantId }),
    Supplier.countDocuments({ __allowGlobal: true, tenantId }),
    PurchaseOrder.countDocuments({ __allowGlobal: true, tenantId }),
    Invoice.countDocuments({ __allowGlobal: true, tenantId }),
    Payment.countDocuments({ __allowGlobal: true, tenantId }),
    Notification.countDocuments({ __allowGlobal: true, tenantId }),
    AiInsight.countDocuments({ __allowGlobal: true, tenantId }),
    AiCall.countDocuments({ __allowGlobal: true, tenantId }),
  ]);

  return {
    drugs,
    branches,
    staff: {
      owners,
      managers,
      cashiers,
      other: otherStaff,
      total: owners + managers + cashiers + otherStaff,
    },
    sales,
    customers,
    patients,
    prescriptions,
    suppliers,
    purchaseOrders,
    invoices,
    payments,
    notifications,
    aiInsights,
    aiCalls,
  };
}

const stats = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const tenant = await Tenant.findById(req.params.id)
    .select('name slug status planCode country')
    .lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const businessStats = await collectStats(tenant._id);
  return ok(res, { tenant, stats: businessStats });
});

/* ─────────────── REMOVE ─────────────── */
/*  Default: soft delete (status → 'deleted', users suspended)
 *  ?hard=true: hard delete everything + return pre-delete stats
 */

const remove = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const tenant = await Tenant.findById(req.params.id).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const hard = String(req.query.hard) === 'true';

  /* ── Soft delete ── */
  if (!hard) {
    await Tenant.updateOne(
      { _id: tenant._id },
      {
        $set: {
          status: 'deleted',
          deletedAt: new Date(),
          deletedBy: req.admin.id,
        },
      }
    );

    await User.updateMany(
      { __allowGlobal: true, tenantId: tenant._id },
      { $set: { status: 'suspended' } }
    );

    const owner = await User.findOne({
      __allowGlobal: true,
      tenantId: tenant._id,
      role: 'owner',
    }).lean();

    if (owner?.email) {
      emailService
        .sendStaffDeactivated({
          tenantId: tenant._id,
          to: owner.email,
          fullName: owner.fullName,
          businessName: tenant.name,
        })
        .catch(() => {});
    }

    await AdminAction.create({
      adminId: req.admin.id,
      tenantId: tenant._id,
      action: 'tenant.delete_soft',
      metadata: { name: tenant.name, slug: tenant.slug },
      ip: req.ip,
    }).catch(() => {});

    return ok(res, {
      deleted: true,
      permanent: false,
      tenantId: tenant._id,
      tenantName: tenant.name,
    });
  }

  /* ── Hard delete ── */
  const preStats = await collectStats(tenant._id);
  const scope = { tenantId: tenant._id };

  await Promise.all([
    Drug.deleteMany({ __allowGlobal: true, ...scope }),
    Batch.deleteMany({ __allowGlobal: true, ...scope }),
    StockMovement.deleteMany({ __allowGlobal: true, ...scope }),
    Customer.deleteMany({ __allowGlobal: true, ...scope }),
    Patient.deleteMany({ __allowGlobal: true, ...scope }),
    Prescription.deleteMany({ __allowGlobal: true, ...scope }),
    Sale.deleteMany({ __allowGlobal: true, ...scope }),
    Supplier.deleteMany({ __allowGlobal: true, ...scope }),
    PurchaseOrder.deleteMany({ __allowGlobal: true, ...scope }),
    Invoice.deleteMany({ __allowGlobal: true, ...scope }),
    Payment.deleteMany({ __allowGlobal: true, ...scope }),
    Notification.deleteMany({ __allowGlobal: true, ...scope }),
    AppNotification.deleteMany({ __allowGlobal: true, ...scope }),
    AiInsight.deleteMany({ __allowGlobal: true, ...scope }),
    AiCall.deleteMany({ __allowGlobal: true, ...scope }),
    User.deleteMany({ __allowGlobal: true, ...scope }),
    Branch.deleteMany({ __allowGlobal: true, ...scope }),
    Subscription.deleteMany({ tenantId: tenant._id }),
    PendingActivation.deleteMany({ tenantId: tenant._id }),
    Tenant.deleteOne({ _id: tenant._id }),
  ]);

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'tenant.delete_hard',
    metadata: {
      name: tenant.name,
      slug: tenant.slug,
      planCode: tenant.planCode,
      country: tenant.country,
      preStats,
    },
    ip: req.ip,
  }).catch(() => {});

  return ok(res, {
    deleted: true,
    permanent: true,
    tenantId: tenant._id,
    tenantName: tenant.name,
    purged: preStats,
  });
});

/* ─────────────── IMPERSONATE ─────────────── */

const impersonate = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'tenantId');

  const tenant = await Tenant.findById(req.params.id).lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');

  const owner = await User.findOne({
    __allowGlobal: true,
    tenantId: tenant._id,
    role: 'owner',
  }).lean();
  if (!owner) throw ApiError.notFound('OWNER_NOT_FOUND', 'Owner not found');

  const token = signAccessToken(
    {
      sub: String(owner._id),
      tenantId: String(tenant._id),
      role: 'owner',
      branchIds: [],
      scope: 'active',
      impersonatedBy: String(req.admin.id),
    },
    'tenant'
  );

  await AdminAction.create({
    adminId: req.admin.id,
    tenantId: tenant._id,
    action: 'tenant.impersonate',
    ip: req.ip,
  }).catch(() => {});

  return ok(res, {
    accessToken: token,
    tenant: { id: tenant._id, name: tenant.name },
    owner: { id: owner._id, email: owner.email, fullName: owner.fullName },
  });
});

module.exports = { list, get, update, suspend, reactivate, stats, remove, impersonate };