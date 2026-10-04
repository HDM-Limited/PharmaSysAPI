const Plan = require('../models/admin/Plan');
const Tenant = require('../models/admin/Tenant');
const { ApiError } = require('../utils/apiError');

const CACHE = new Map();
const CACHE_TTL_MS = 60 * 1000;

function cacheGet(code) {
  const entry = CACHE.get(code);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    CACHE.delete(code);
    return null;
  }
  return entry.plan;
}

function cacheSet(code, plan) {
  CACHE.set(code, { plan, at: Date.now() });
}

function invalidateCache(code) {
  if (code) CACHE.delete(code);
  else CACHE.clear();
}

async function list({ onlyPublic = false, onlyActive = false } = {}) {
  const filter = {};
  if (onlyPublic) filter.isPublic = true;
  if (onlyActive) filter.isActive = true;
  return Plan.find(filter).sort({ sortOrder: 1, code: 1 }).lean();
}

async function getByCode(code) {
  if (!code) throw ApiError.badRequest('PLAN_REQUIRED', 'Plan code required');

  const cached = cacheGet(code);
  if (cached) return cached;

  const plan = await Plan.findOne({ code }).lean();
  if (!plan) throw ApiError.notFound('PLAN_NOT_FOUND', `Plan '${code}' not found`);

  cacheSet(code, plan);
  return plan;
}

async function getById(id) {
  const plan = await Plan.findById(id).lean();
  if (!plan) throw ApiError.notFound('PLAN_NOT_FOUND', 'Plan not found');
  return plan;
}

async function getTenantPlan(tenantId) {
  const tenant = await Tenant.findById(tenantId).select('planCode').lean();
  if (!tenant) throw ApiError.notFound('TENANT_NOT_FOUND', 'Tenant not found');
  return getByCode(tenant.planCode || 'free');
}

async function assertFeature(tenantId, feature) {
  const plan = await getTenantPlan(tenantId);
  if (plan.features?.[feature] !== true) {
    throw ApiError.forbidden('FEATURE_DISABLED', `${feature} is not available on plan '${plan.name}'`);
  }
  return true;
}

async function hasFeature(tenantId, feature) {
  const plan = await getTenantPlan(tenantId);
  return plan.features?.[feature] === true;
}

async function checkLimit({ tenantId, limitKey, count }) {
  const plan = await getTenantPlan(tenantId);
  const max = plan.limits?.[limitKey];
  if (typeof max !== 'number') return true;
  if (max === 0) return true;
  if (count >= max) {
    throw ApiError.badRequest('LIMIT_REACHED', `Plan '${plan.name}' allows ${max} for ${limitKey}`);
  }
  return true;
}

module.exports = {
  list,
  getByCode,
  getById,
  getTenantPlan,
  assertFeature,
  hasFeature,
  checkLimit,
  invalidateCache,
};