const { asyncHandler } = require('../../utils/asyncHandler');
const { ok, created } = require('../../utils/apiResponse');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const Legal = require('../../models/admin/Legal');
const adminActionService = require('../../services/adminActionService');

const list = asyncHandler(async (_req, res) => {
  const docs = await Legal.find().sort({ type: 1, version: -1 }).lean();
  return ok(res, docs);
});

const get = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'legalId');
  const doc = await Legal.findById(req.params.id).lean();
  if (!doc) throw ApiError.notFound('LEGAL_NOT_FOUND', 'Legal document not found');
  return ok(res, doc);
});

const create = asyncHandler(async (req, res) => {
  const { type, title, content } = req.body;
  if (!type || !title || !content) throw ApiError.badRequest('MISSING_FIELDS', 'type, title, content required');

  const last = await Legal.findOne({ type }).sort({ version: -1 }).lean();
  const version = (last?.version || 0) + 1;

  const doc = await Legal.create({
    type,
    version,
    title,
    content,
    effectiveAt: new Date(),
    publishedAt: new Date(),
    publishedBy: req.admin.id,
    isCurrent: true,
  });

  if (last) await Legal.updateOne({ _id: last._id }, { $set: { isCurrent: false } });

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'legal.publish',
    metadata: { type, version },
    ip: req.ip,
  });

  return created(res, doc.toObject());
});

const setCurrent = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'legalId');
  const doc = await Legal.findById(req.params.id);
  if (!doc) throw ApiError.notFound('LEGAL_NOT_FOUND', 'Legal document not found');

  await Legal.updateMany({ type: doc.type }, { $set: { isCurrent: false } });
  doc.isCurrent = true;
  await doc.save();

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'legal.set_current',
    metadata: { type: doc.type, version: doc.version },
    ip: req.ip,
  });

  return ok(res, doc.toObject());
});

const listPublic = asyncHandler(async (_req, res) => {
  const docs = await Legal.find({ isCurrent: true }).select('type title version effectiveAt').lean();
  return ok(res, docs);
});

const getCurrentByType = asyncHandler(async (req, res) => {
  const doc = await Legal.findOne({ type: req.params.type, isCurrent: true }).lean();
  if (!doc) throw ApiError.notFound('LEGAL_NOT_FOUND', 'Legal document not found');
  return ok(res, {
    type: doc.type,
    version: doc.version,
    title: doc.title,
    content: doc.content,
    effectiveAt: doc.effectiveAt,
  });
});

module.exports = { list, get, create, setCurrent, listPublic, getCurrentByType };