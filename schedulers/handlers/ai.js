const Tenant = require('../../models/admin/Tenant');
const aiService = require('../../services/aiService');
const { logger } = require('../../utils/logger');

async function activeTenants() {
  return Tenant.find({ status: 'active' }).select('_id name country').lean();
}

function baseContext(tenant) {
  return {
    tenantName: tenant.name,
    country: tenant.country || 'KE',
    branchName: null,
    periodLabel: 'Last 7 days',
    salesTotal: 0,
    txCount: 0,
    topDrugs: [],
    lowStock: [],
    expiring: [],
    currency: 'KES',
  };
}

async function runInsights() {
  const tenants = await activeTenants();
  let generated = 0;
  for (const tenant of tenants) {
    try {
      await aiService.generateWeeklyInsights({ tenantId: tenant._id, context: baseContext(tenant), force: true });
      generated++;
    } catch (err) {
      logger.warn({ err: err.message, tenantId: String(tenant._id) }, 'ai insights failed');
    }
  }
  logger.info({ generated }, 'ai insights job complete');
  return { generated };
}

async function runForecast() {
  const tenants = await activeTenants();
  let generated = 0;
  for (const tenant of tenants) {
    try {
      await aiService.generateStockForecast({ tenantId: tenant._id, context: baseContext(tenant), force: true });
      generated++;
    } catch (err) {
      logger.warn({ err: err.message, tenantId: String(tenant._id) }, 'ai forecast failed');
    }
  }
  logger.info({ generated }, 'ai forecast job complete');
  return { generated };
}

async function runExpiryRisk() {
  const tenants = await activeTenants();
  let generated = 0;
  for (const tenant of tenants) {
    try {
      await aiService.generateExpiryRisk({ tenantId: tenant._id, context: baseContext(tenant), force: true });
      generated++;
    } catch (err) {
      logger.warn({ err: err.message, tenantId: String(tenant._id) }, 'ai expiry-risk failed');
    }
  }
  logger.info({ generated }, 'ai expiry-risk job complete');
  return { generated };
}

module.exports = { runInsights, runForecast, runExpiryRisk };