const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created, noContent, paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');

const Patient = require('../../models/client/Patient');
const Sale = require('../../models/client/Sale');
const Prescription = require('../../models/client/Prescription');

/* ─────────────── LIST ─────────────── */

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { tenantId: req.tenantId, isActive: true };
  if (req.query.search) {
    filter.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { phone: { $regex: req.query.search, $options: 'i' } },
    ];
  }

  const [items, total] = await Promise.all([
    Patient.find({ __allowGlobal: true, ...filter })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Patient.countDocuments({ __allowGlobal: true, ...filter }),
  ]);

  return paginated(res, items, page, limit, total);
});

/* ─────────────── GET ─────────────── */

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'patientId');
  const patient = await Patient.findOne({
    __allowGlobal: true,
    _id: req.params.id,
    tenantId: req.tenantId,
  }).lean();
  if (!patient) throw ApiError.notFound('PATIENT_NOT_FOUND', 'Patient not found');
  return ok(res, patient);
});

/* ─────────────── CREATE ─────────────── */

const create = asyncHandler(async (req, res) => {
  const { name, phone, email, dob, gender, allergies, chronicConditions, notes } = req.body;
  if (!name) throw ApiError.badRequest('MISSING_FIELDS', 'name required');

  const patient = await Patient.create({
    tenantId: req.tenantId,
    name: name.trim(),
    phone: phone || null,
    email: email || null,
    dob: dob ? new Date(dob) : null,
    gender: gender || null,
    allergies: allergies || [],
    chronicConditions: chronicConditions || [],
    notes: notes || null,
    isActive: true,
  });

  return created(res, patient.toObject());
});

/* ─────────────── UPDATE ─────────────── */

const update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'patientId');
  const allowed = ['name', 'phone', 'email', 'dob', 'gender', 'allergies', 'chronicConditions', 'notes'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
  if (patch.dob) patch.dob = new Date(patch.dob);

  const patient = await Patient.findOneAndUpdate(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: patch },
    { new: true, runValidators: true }
  ).lean();

  if (!patient) throw ApiError.notFound('PATIENT_NOT_FOUND', 'Patient not found');
  return ok(res, patient);
});

/* ─────────────── REMOVE (soft or hard) ─────────────── */

const remove = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'patientId');
  const hard = String(req.query.hard) === 'true';

  if (hard && req.user.role !== 'owner') {
    throw ApiError.forbidden('ONLY_OWNER', 'Only the owner can permanently delete patients');
  }

  if (hard) {
    const result = await Patient.deleteOne({
      __allowGlobal: true,
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (result.deletedCount === 0) {
      throw ApiError.notFound('PATIENT_NOT_FOUND', 'Patient not found');
    }
    return ok(res, { deleted: true, permanent: true });
  }

  const result = await Patient.updateOne(
    { __allowGlobal: true, _id: req.params.id, tenantId: req.tenantId },
    { $set: { isActive: false } }
  );
  if (result.matchedCount === 0) {
    throw ApiError.notFound('PATIENT_NOT_FOUND', 'Patient not found');
  }
  return noContent(res);
});

/* ─────────────── SALES ─────────────── */

const sales = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'patientId');
  const items = await Sale.find({
    __allowGlobal: true,
    tenantId: req.tenantId,
    patientId: req.params.id,
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return ok(res, items);
});

/* ─────────────── PRESCRIPTIONS ─────────────── */

const prescriptions = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'patientId');
  const items = await Prescription.find({
    __allowGlobal: true,
    tenantId: req.tenantId,
    patientId: req.params.id,
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return ok(res, items);
});

module.exports = { list, get, create, update, remove, sales, prescriptions };