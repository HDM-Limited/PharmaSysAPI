const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, paginated, noContent } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const { env } = require('../../config/env');

const Prescription = require('../../models/client/Prescription');
const Patient = require('../../models/client/Patient');
const Branch = require('../../models/client/Branch');
const Tenant = require('../../models/admin/Tenant');
const { Batch, StockMovement } = require('../../models/client/Inventory');
const notificationService = require('../../services/notificationService');
const emailService = require('../../services/emailService');
const smsService = require('../../services/smsService');

/* ─────────────── LIST ─────────────── */

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { tenantId: req.tenantId };
  if (req.branchId) filter.branchId = req.branchId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.patientId) filter.patientId = req.query.patientId;

  const [items, total] = await Promise.all([
    Prescription.find({ __allowGlobal: true, ...filter })
      .populate('patientId', 'name phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Prescription.countDocuments({ __allowGlobal: true, ...filter }),
  ]);

  return paginated(res, items, page, limit, total);
});

/* ─────────────── GET ─────────────── */

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'prescriptionId');
  const rx = await Prescription.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  })
    .populate('patientId', 'name phone allergies')
    .populate('doctorId', 'name clinic')
    .lean();
  if (!rx) throw ApiError.notFound('PRESCRIPTION_NOT_FOUND', 'Prescription not found');
  return ok(res, rx);
});

/* ─────────────── CREATE ─────────────── */

const create = asyncHandler(async (req, res) => {
  const { patientId, doctorId = null, refNo = null, items, notes = null } = req.body;
  if (!patientId || !Array.isArray(items) || !items.length) {
    throw ApiError.badRequest('MISSING_FIELDS', 'patientId and items required');
  }

  const patient = await Patient.findOne({
    __allowGlobal: true,
    _id: patientId,
    tenantId: req.tenantId,
  }).lean();
  if (!patient) throw ApiError.notFound('PATIENT_NOT_FOUND', 'Patient not found');

  const branchId = req.branchId || req.branchIds[0];
  if (!branchId) throw ApiError.badRequest('BRANCH_REQUIRED', 'A branch is required');

  const rx = await Prescription.create({
    tenantId: req.tenantId,
    branchId,
    patientId,
    doctorId,
    refNo,
    status: 'pending',
    items,
    notes,
  });

  return created(res, rx.toObject());
});

/* ─────────────── UPDATE ─────────────── */

const update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'prescriptionId');
  const allowed = ['doctorId', 'refNo', 'items', 'notes', 'status'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  const rx = await Prescription.findOneAndUpdate(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: patch },
    { new: true, runValidators: true }
  ).lean();

  if (!rx) throw ApiError.notFound('PRESCRIPTION_NOT_FOUND', 'Prescription not found');
  return ok(res, rx);
});

/* ─────────────── DISPENSE ─────────────── */

const dispense = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'prescriptionId');
  const rx = await Prescription.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!rx) throw ApiError.notFound('PRESCRIPTION_NOT_FOUND', 'Prescription not found');
  if (rx.status === 'dispensed') throw ApiError.badRequest('ALREADY_DISPENSED', 'Already dispensed');

  const branchId = rx.branchId || req.branchId || req.branchIds[0];

  for (const item of rx.items) {
    const batches = await Batch.find({
      __allowGlobal: true,
      tenantId: req.tenantId,
      branchId,
      drugId: item.drugId,
      qty: { $gt: 0 },
      expiryDate: { $gt: new Date() },
    })
      .sort({ expiryDate: 1 })
      .lean();

    let remaining = item.qty;
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(b.qty, remaining);
      await Batch.updateOne({ __allowGlobal: true, _id: b._id }, { $inc: { qty: -take } });
      await StockMovement.create({
        tenantId: req.tenantId,
        branchId,
        drugId: item.drugId,
        batchId: b._id,
        type: 'out',
        qty: take,
        ref: `RX ${rx.refNo || rx._id}`,
        userId: req.user._id,
        note: 'prescription dispense',
      });
      remaining -= take;
    }

    if (remaining > 0) {
      throw ApiError.badRequest('INSUFFICIENT_STOCK', `Not enough stock to dispense ${item.drugId}`);
    }
  }

  rx.status = 'dispensed';
  rx.dispensedBy = req.user._id;
  rx.dispensedAt = new Date();
  await rx.save();

  const patient = await Patient.findOne({ __allowGlobal: true, _id: rx.patientId }).lean();
  const tenant = await Tenant.findById(req.tenantId).select('name').lean();
  const branch = await Branch.findById(branchId).select('name').lean();

  notificationService
    .notifyBranchManagers({
      tenantId: req.tenantId,
      branchId,
      type: 'prescription',
      title: 'Prescription dispensed',
      body: `Ref ${rx.refNo || rx._id} is ready`,
      link: `/app/prescriptions/${rx._id}`,
      meta: { prescriptionId: String(rx._id), patientName: patient?.name },
    })
    .catch(() => {});

  if (patient) {
    const rxRef = rx.refNo || String(rx._id).slice(-6);
    const pickupUrl = `${env.appUrl}/pending`;

    if (patient.email) {
      emailService
        .sendPrescriptionReady({
          tenantId: req.tenantId,
          to: patient.email,
          businessName: tenant?.name || 'PharmaSys',
          patientName: patient.name,
          prescriptionRef: rxRef,
          branchName: branch?.name,
          pickupUrl,
        })
        .catch(() => {});
    }

    if (patient.phone) {
      smsService
        .sendPrescriptionReady({
          tenantId: req.tenantId,
          to: patient.phone,
          patientName: patient.name,
          prescriptionRef: rxRef,
          branchName: branch?.name,
        })
        .catch(() => {});
    }
  }

  return ok(res, rx.toObject());
});

/* ─────────────── CANCEL (soft state) ─────────────── */

const cancel = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'prescriptionId');
  const { reason = null } = req.body;

  const rx = await Prescription.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!rx) throw ApiError.notFound('PRESCRIPTION_NOT_FOUND', 'Prescription not found');
  if (rx.status === 'dispensed') {
    throw ApiError.badRequest('ALREADY_DISPENSED', 'Cannot cancel a dispensed prescription');
  }
  if (rx.status === 'cancelled') {
    throw ApiError.badRequest('ALREADY_CANCELLED', 'Prescription is already cancelled');
  }

  rx.status = 'cancelled';
  if (reason) rx.notes = `${rx.notes || ''}\nCancelled: ${reason}`.trim();
  await rx.save();

  return ok(res, rx.toObject());
});

/* ─────────────── REMOVE (soft or hard) ─────────────── */

const remove = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'prescriptionId');
  const hard = String(req.query.hard) === 'true';

  if (hard && req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can permanently delete prescriptions');
  }

  const rx = await Prescription.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  });
  if (!rx) throw ApiError.notFound('PRESCRIPTION_NOT_FOUND', 'Prescription not found');

  if (hard) {
    if (rx.status === 'dispensed') {
      throw ApiError.badRequest(
        'PRESCRIPTION_DISPENSED',
        'Cannot permanently delete a dispensed prescription. Cancel or archive instead.'
      );
    }

    await Prescription.deleteOne({ _id: rx._id });
    return ok(res, { deleted: true, permanent: true });
  }

  rx.status = 'cancelled';
  await rx.save();
  return noContent(res);
});

module.exports = { list, get, create, update, dispense, cancel, remove };