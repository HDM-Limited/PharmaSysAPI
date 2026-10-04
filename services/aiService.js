const crypto = require('crypto');
const hdmAi = require('../config/hdmAi');
const { AiInsight, AiCall } = require('../models/client/Ai');
const contextService = require('./contextService');
const planService = require('./planService');
const settingsService = require('./settingsService');
const { ApiError } = require('../utils/apiError');
const { logger } = require('../utils/logger');

function hashPrompt(message, systemPrompt) {
  return crypto.createHash('sha256').update(`${message}|${systemPrompt}`).digest('hex');
}

/* ═══════════════════════════════════════════════════════════
   QUOTA
   ═══════════════════════════════════════════════════════════ */

async function assertQuota(tenantId) {
  const plan = await planService.getTenantPlan(tenantId);
  const max = plan.limits?.maxAiCallsPerDay ?? 20;
  if (max <= 0) return;

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const count = await AiCall.countDocuments({
    __allowGlobal: true,
    tenantId,
    createdAt: { $gte: start },
  });

  if (count >= max) {
    throw ApiError.badRequest('AI_QUOTA_EXCEEDED', `Daily AI quota (${max}) reached`);
  }
}

/* ═══════════════════════════════════════════════════════════
   CORE CALL + LOG
   ═══════════════════════════════════════════════════════════ */

async function callAndLog({ tenantId, feature, message, systemPrompt, promptPreview = null }) {
  if (!hdmAi.enabled) throw ApiError.internal('AI_DISABLED', 'HDM AI is not configured');

  const promptHash = hashPrompt(message, systemPrompt);
  const started = Date.now();

  try {
    const result = await hdmAi.complete({ message, systemPrompt });

    AiCall.create({
      tenantId,
      feature,
      promptHash,
      tokensUsed: result.tokensUsed,
      latencyMs: Date.now() - started,
      provider: result.provider,
      model: result.model,
      success: true,
      promptPreview: promptPreview || message.slice(0, 120),
    }).catch(() => {});

    return result;
  } catch (err) {
    AiCall.create({
      tenantId,
      feature,
      promptHash,
      latencyMs: Date.now() - started,
      success: false,
      error: err.message,
      promptPreview: promptPreview || message.slice(0, 120),
    }).catch(() => {});

    logger.error({ err: err.message, feature, tenantId: String(tenantId) }, 'AI call failed');
    throw err;
  }
}

/* ═══════════════════════════════════════════════════════════
   LANDING CHAT — public, no auth, never throws
   ═══════════════════════════════════════════════════════════ */

async function landingChat({ message, ip = null }) {
  const ctx = await contextService.buildLandingContext();

  if (!ctx.landingEnabled || !hdmAi.enabled) {
    return { reply: ctx.greeting, fallback: true };
  }

  const promptHash = hashPrompt(message, ctx.systemPrompt);
  const started = Date.now();

  try {
    const result = await hdmAi.complete({ message, systemPrompt: ctx.systemPrompt });

    AiCall.create({
      tenantId: null,
      feature: 'landing_chat',
      promptHash,
      tokensUsed: result.tokensUsed,
      latencyMs: Date.now() - started,
      provider: result.provider,
      model: result.model,
      success: true,
      promptPreview: message.slice(0, 120),
    }).catch(() => {});

    return { reply: result.reply, fallback: false };
  } catch (err) {
    AiCall.create({
      tenantId: null,
      feature: 'landing_chat',
      promptHash,
      latencyMs: Date.now() - started,
      success: false,
      error: err.message,
      promptPreview: message.slice(0, 120),
    }).catch(() => {});

    logger.warn({ err: err.message, ip }, 'landing ai failed');
    return { reply: ctx.greeting, fallback: true };
  }
}

/* ═══════════════════════════════════════════════════════════
   CLIENT CHAT — tenant, quota enforced
   ═══════════════════════════════════════════════════════════ */

async function tenantChat({ tenantId, branchId = null, message }) {
  if (!tenantId) throw ApiError.unauthorized('NO_TENANT', 'Tenant context required');
  if (!message || typeof message !== 'string') throw ApiError.badRequest('MESSAGE_REQUIRED', 'message required');

  const planEnabled = await settingsService.get('feature_ai_insights', true);
  if (!planEnabled) throw ApiError.forbidden('AI_DISABLED', 'AI is disabled');

  const aiConfig = await settingsService.getAiConfig();
  if (aiConfig.features?.clientAi === false) {
    throw ApiError.forbidden('AI_DISABLED', 'AI is disabled for this account');
  }

  await assertQuota(tenantId);

  const ctx = await contextService.buildTenantContext({ tenantId, branchId });

  return callAndLog({
    tenantId,
    feature: 'chat',
    message,
    systemPrompt: ctx.systemPrompt,
  });
}

/* ═══════════════════════════════════════════════════════════
   INSIGHTS CACHE
   ═══════════════════════════════════════════════════════════ */

async function getCachedInsight({ tenantId, type, branchId = null }) {
  const now = new Date();
  const query = {
    __allowGlobal: true,
    tenantId,
    type,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  };
  if (branchId) query.branchId = branchId;

  return AiInsight.findOne(query).sort({ createdAt: -1 }).lean();
}

async function saveInsight({ tenantId, branchId = null, type, payload, periodStart = null, periodEnd = null, confidence = null, model = null, ttlHours = 24 }) {
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

  return AiInsight.create({
    tenantId,
    branchId,
    type,
    periodStart,
    periodEnd,
    payload,
    confidence,
    model,
    generatedAt: new Date(),
    expiresAt,
  });
}

/* ═══════════════════════════════════════════════════════════
   INSIGHT GENERATORS
   ═══════════════════════════════════════════════════════════ */

async function generateWeeklyInsights({ tenantId, branchId = null, force = false }) {
  const type = 'weekly_insight';

  if (!force) {
    const cached = await getCachedInsight({ tenantId, type, branchId });
    if (cached) return cached;
  }

  await assertQuota(tenantId);

  const ctx = await contextService.buildTenantContext({ tenantId, branchId });

  const message = [
    'Summarize the current period for this pharmacy.',
    'Highlight:',
    '1. Total sales and trend versus the previous period if inferable.',
    '2. Top performing drug categories.',
    '3. One risk worth attention (stock, expiry, or slow movers).',
    '4. One actionable recommendation.',
    'Keep it concise and business-focused.',
  ].join(' ');

  const result = await callAndLog({
    tenantId,
    feature: 'insights',
    message,
    systemPrompt: ctx.systemPrompt,
  });

  return saveInsight({
    tenantId,
    branchId,
    type,
    payload: { text: result.reply, context: ctx.context },
    periodStart: new Date(Date.now() - ctx.context.windowDays * 86400000),
    periodEnd: new Date(),
    model: result.model,
    ttlHours: 24,
  });
}

async function generateStockForecast({ tenantId, branchId = null, force = false }) {
  const type = 'stock_forecast';

  if (!force) {
    const cached = await getCachedInsight({ tenantId, type, branchId });
    if (cached) return cached;
  }

  await assertQuota(tenantId);

  const ctx = await contextService.buildTenantContext({ tenantId, branchId });

  const message = [
    'Based on the sales data, forecast which drugs are likely to run out in the next 7 days.',
    'Use current stock, low-stock items, and top-selling drugs.',
    'Return a short list: drug name, estimated days left, suggested reorder quantity.',
    'If data is insufficient, say so.',
  ].join(' ');

  const result = await callAndLog({
    tenantId,
    feature: 'forecast',
    message,
    systemPrompt: ctx.systemPrompt,
  });

  return saveInsight({
    tenantId,
    branchId,
    type,
    payload: { text: result.reply, context: ctx.context },
    model: result.model,
    ttlHours: 12,
  });
}

async function generateExpiryRisk({ tenantId, branchId = null, force = false }) {
  const type = 'expiry_risk';

  if (!force) {
    const cached = await getCachedInsight({ tenantId, type, branchId });
    if (cached) return cached;
  }

  await assertQuota(tenantId);

  const ctx = await contextService.buildTenantContext({ tenantId, branchId });

  const message = [
    'List the drugs with the highest risk of expiring unsold based on the expiring batches and current sales velocity.',
    'For each, suggest whether to discount, transfer, or return to supplier.',
    'Return a short ranked list.',
    'If data is insufficient, say so.',
  ].join(' ');

  const result = await callAndLog({
    tenantId,
    feature: 'expiry_risk',
    message,
    systemPrompt: ctx.systemPrompt,
  });

  return saveInsight({
    tenantId,
    branchId,
    type,
    payload: { text: result.reply, context: ctx.context },
    model: result.model,
    ttlHours: 24,
  });
}

/* ═══════════════════════════════════════════════════════════
   QUOTA CHECK (exposed for controllers if needed)
   ═══════════════════════════════════════════════════════════ */

async function remainingQuota(tenantId) {
  const plan = await planService.getTenantPlan(tenantId);
  const max = plan.limits?.maxAiCallsPerDay ?? 20;
  if (max <= 0) return { unlimited: true, used: 0, max: 0, remaining: null };

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const used = await AiCall.countDocuments({
    __allowGlobal: true,
    tenantId,
    createdAt: { $gte: start },
  });

  return {
    unlimited: false,
    used,
    max,
    remaining: Math.max(0, max - used),
  };
}

module.exports = {
  landingChat,
  tenantChat,
  generateWeeklyInsights,
  generateStockForecast,
  generateExpiryRisk,
  getCachedInsight,
  saveInsight,
  remainingQuota,
  assertQuota,
  callAndLog,
};