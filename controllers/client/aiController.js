const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { ApiError } = require('../../utils/apiError');
const aiService = require('../../services/aiService');
const { AiCall } = require('../../models/client/Ai');
const Tenant = require('../../models/admin/Tenant');
const Plan = require('../../models/admin/Plan');

const chat = asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message) throw ApiError.badRequest('MESSAGE_REQUIRED', 'message required');

  const result = await aiService.tenantChat({
    tenantId: req.tenantId,
    branchId: req.branchId,
    message,
  });

  return ok(res, { reply: result.reply, model: result.model });
});

const insights = asyncHandler(async (req, res) => {
  const insight = await aiService.generateWeeklyInsights({
    tenantId: req.tenantId,
    branchId: req.branchId,
    force: req.query.refresh === 'true',
  });
  return ok(res, insight);
});

const forecast = asyncHandler(async (req, res) => {
  const insight = await aiService.generateStockForecast({
    tenantId: req.tenantId,
    branchId: req.branchId,
    force: req.query.refresh === 'true',
  });
  return ok(res, insight);
});

const expiryRisk = asyncHandler(async (req, res) => {
  const insight = await aiService.generateExpiryRisk({
    tenantId: req.tenantId,
    branchId: req.branchId,
    force: req.query.refresh === 'true',
  });
  return ok(res, insight);
});

const quota = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId).select('planCode').lean();
  const plan = await Plan.findOne({ code: tenant?.planCode }).lean();
  const max = plan?.limits?.maxAiCallsPerDay ?? 20;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const used = await AiCall.countDocuments({
    tenantId: req.tenantId,
    createdAt: { $gte: startOfDay },
  });

  if (max === 0) {
    return ok(res, { unlimited: true, used, max: 0, remaining: null });
  }

  return ok(res, {
    unlimited: false,
    used,
    max,
    remaining: Math.max(0, max - used),
  });
});

module.exports = { chat, insights, forecast, expiryRisk, quota };