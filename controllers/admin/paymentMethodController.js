const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { assertObjectId } = require('../../utils/validateObjectId');
const { ApiError } = require('../../utils/apiError');
const PaymentMethod = require('../../models/admin/PaymentMethod');
const adminActionService = require('../../services/adminActionService');

function maskConfig(config = {}) {
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    if (/secret|key|pass/i.test(k) && typeof v === 'string' && v.length > 8) {
      out[k] = `***${v.slice(-4)}`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

const list = asyncHandler(async (_req, res) => {
  const methods = await PaymentMethod.find().sort({ order: 1 }).lean();
  return ok(res, methods.map((m) => ({ ...m, config: maskConfig(m.config) })));
});

const update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'methodId');

  const allowed = ['label', 'enabled', 'requiresApproval', 'order', 'config'];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

  if (patch.config) {
    const existing = await PaymentMethod.findById(req.params.id).lean();
    const current = existing?.config || {};
    const next = { ...current };
    for (const [k, v] of Object.entries(patch.config)) {
      if (typeof v === 'string' && v.startsWith('***')) continue;
      next[k] = v;
    }
    patch.config = next;
  }

  const method = await PaymentMethod.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
  if (!method) throw ApiError.notFound('METHOD_NOT_FOUND', 'Payment method not found');

  await adminActionService.log({
    adminId: req.admin.id,
    action: 'payment_method.update',
    metadata: { code: method.code },
    ip: req.ip,
  });

  return ok(res, { ...method, config: maskConfig(method.config) });
});

module.exports = { list, update };