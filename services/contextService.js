const Tenant = require('../models/admin/Tenant');
const Branch = require('../models/client/Branch');
const Plan = require('../models/admin/Plan');
const Legal = require('../models/admin/Legal');
const PlatformSetting = require('../models/admin/PlatformSetting');
const { Drug, Batch } = require('../models/client/Inventory');
const Sale = require('../models/client/Sale');
const { runAsTenant } = require('../models/plugins/context');
const settingsService = require('./settingsService');

/* ═══════════════════════════════════════════════════════════
   LANDING CONTEXT — public, cross-tenant, reads platform data
   ═══════════════════════════════════════════════════════════ */

const LANDING_KEYS = [
  'platform_name',
  'platform_website',
  'support_email',
  'support_phone',
  'platform_whatsapp',
  'default_country',
  'default_currency',
  'countries',
  'currencies',
  'business_types',
  'feature_pos',
  'feature_inventory',
  'feature_prescriptions',
  'feature_patient_records',
  'feature_expiry_alerts',
  'feature_purchase_orders',
  'feature_invoices',
  'feature_ai_insights',
  'feature_multi_branch',
  'feature_interaction_check',
  'feature_loyalty',
  'feature_api',
  'chat_greeting',
  'chat_disclaimer',
  'downloads',
];

function formatPlanLine(plan) {
  const price = plan.price?.amount
    ? `${plan.price.currency} ${plan.price.amount}/${plan.price.interval}`
    : 'Free';

  const features = Object.entries(plan.features || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .join(', ');

  const l = plan.limits || {};
  const limits = [
    `branches:${l.maxBranches ?? 1}`,
    `managers:${l.maxManagersPerBranch ?? 0}`,
    `cashiers:${l.maxCashiersPerBranch ?? 0}`,
    `products:${l.maxProducts ?? 0}`,
    `ai/day:${l.maxAiCallsPerDay ?? 0}`,
    `sms/mo:${l.maxSmsPerMonth ?? 0}`,
  ].join(', ');

  const trial = plan.trialDays ? ` · trial ${plan.trialDays}d` : '';

  return `- ${plan.name} (${plan.code}): ${price}${trial} — ${plan.description || 'no description'} | limits ${limits} | features ${features || 'none'}`;
}

async function loadLandingSettings() {
  const docs = await PlatformSetting.find({ key: { $in: LANDING_KEYS } }).lean();
  return Object.fromEntries(docs.map((d) => [d.key, d.value]));
}

async function buildLandingContext() {
  const brand = await settingsService.getBrand();
  const settings = await loadLandingSettings();
  const aiConfig = await settingsService.getAiConfig();
  const landingEnabled = aiConfig?.features?.landingAi === true;

  const plans = await Plan.find({ isPublic: true, isActive: true })
    .sort({ sortOrder: 1 })
    .select('code name description price limits features trialDays')
    .lean();

  const legal = await Legal.find({ isCurrent: true })
    .select('type title version effectiveAt')
    .lean();

  const planLines = plans.length
    ? plans.map(formatPlanLine).join('\n')
    : '- No plans published yet';

  const featureList = Object.keys(settings)
    .filter((k) => k.startsWith('feature_') && settings[k] === true)
    .map((k) => k.replace('feature_', ''))
    .join(', ');

  const countriesList = Array.isArray(settings.countries)
    ? settings.countries.map((c) => `${c.name} (${c.code})`).join(', ')
    : 'Kenya (KE)';

  const currenciesList = Array.isArray(settings.currencies)
    ? settings.currencies.join(', ')
    : 'KES';

  const downloadsList = Array.isArray(settings.downloads) && settings.downloads.length
    ? settings.downloads
        .filter((d) => d.enabled !== false)
        .map((d) => `${d.name} ${d.version} (${d.type})`)
        .join(', ')
    : null;

  const legalList = legal.length
    ? legal.map((d) => `${d.title} v${d.version}`).join(', ')
    : null;

  const systemPrompt = [
    `You are ${brand.name} Assistant on the public website.`,
    `You help visitors understand ${brand.name} — a multi-tenant SaaS for pharmacies.`,
    '',
    'Plans:',
    planLines,
    '',
    `Features enabled: ${featureList || 'basic'}`,
    `Countries supported: ${countriesList}`,
    `Currencies: ${currenciesList}`,
    brand.supportEmail ? `Support email: ${brand.supportEmail}` : '',
    brand.supportPhone ? `Support phone: ${brand.supportPhone}` : '',
    brand.supportWhatsapp ? `WhatsApp: https://wa.me/${brand.supportWhatsapp}` : '',
    brand.website ? `Website: ${brand.website}` : '',
    downloadsList ? `Downloadable apps: ${downloadsList}` : '',
    legalList ? `Legal docs available: ${legalList}` : '',
    '',
    'Rules:',
    `- Answer only about ${brand.name}.`,
    '- Never invent prices, features, or plans — use only the above.',
    '- For signup, point to /register. For pricing, /pricing.',
    '- For help, direct to the contact above.',
    '- If unsure, say so.',
    '- Reply in 1-3 short sentences.',
    '- Never provide medical advice.',
  ].filter(Boolean).join('\n');

  return {
    systemPrompt,
    greeting: settings.chat_greeting || `Hi! Ask me anything about ${brand.name}.`,
    disclaimer: settings.chat_disclaimer || `${brand.name} AI gives business insights only.`,
    landingEnabled,
    meta: {
      planCount: plans.length,
      featureCount: featureList ? featureList.split(',').length : 0,
      countries: settings.countries || [],
      currencies: settings.currencies || [],
      plans,
    },
  };
}

/* ═══════════════════════════════════════════════════════════
   TENANT CONTEXT — tenant-scoped, live business data
   ═══════════════════════════════════════════════════════════ */

const DEFAULT_WINDOW_DAYS = 30;

async function loadTenant(tenantId) {
  return Tenant.findById(tenantId).select('name country planCode status').lean();
}

async function loadPlan(planCode) {
  return Plan.findOne({ code: planCode }).lean();
}

async function loadBranch({ tenantId, branchId }) {
  if (branchId) {
    const branch = await Branch.findById(branchId).select('name code').lean();
    if (branch) return { name: branch.name, code: branch.code, multi: false };
  }
  const count = await Branch.countDocuments({ tenantId, isActive: true });
  return { name: count > 1 ? 'All branches' : 'Main branch', code: null, multi: count > 1 };
}

async function loadSalesSummary({ tenantId, branchId, days = DEFAULT_WINDOW_DAYS }) {
  const since = new Date(Date.now() - days * 86400000);
  const match = {
    tenantId,
    createdAt: { $gte: since },
    status: { $ne: 'voided' },
  };
  if (branchId) match.branchId = branchId;

  const agg = await Sale.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: '$grandTotal' },
        count: { $sum: 1 },
      },
    },
  ]);

  return {
    total: agg[0]?.total || 0,
    count: agg[0]?.count || 0,
    since,
    days,
  };
}

async function loadTopDrugs({ tenantId, branchId, days = DEFAULT_WINDOW_DAYS, limit = 10 }) {
  const since = new Date(Date.now() - days * 86400000);
  const match = {
    tenantId,
    createdAt: { $gte: since },
    status: { $ne: 'voided' },
  };
  if (branchId) match.branchId = branchId;

  const rows = await Sale.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.name',
        qty: { $sum: '$items.qty' },
        revenue: { $sum: '$items.total' },
      },
    },
    { $sort: { qty: -1 } },
    { $limit: limit },
  ]);

  return rows.map((r) => ({ name: r._id, qty: r.qty, revenue: r.revenue }));
}

async function loadLowStock({ tenantId, branchId, limit = 10 }) {
  const drugs = await Drug.find({ tenantId, isActive: true, reorderLevel: { $gt: 0 } })
    .select('name reorderLevel')
    .lean();

  if (!drugs.length) return [];

  const batchMatch = { tenantId };
  if (branchId) batchMatch.branchId = branchId;

  const agg = await Batch.aggregate([
    { $match: batchMatch },
    { $group: { _id: '$drugId', qty: { $sum: '$qty' } } },
  ]);
  const qtyByDrug = Object.fromEntries(agg.map((r) => [String(r._id), r.qty]));

  return drugs
    .map((d) => ({ name: d.name, qty: qtyByDrug[String(d._id)] || 0, reorderLevel: d.reorderLevel }))
    .filter((d) => d.qty <= d.reorderLevel)
    .sort((a, b) => a.qty - b.qty)
    .slice(0, limit);
}

async function loadExpiring({ tenantId, branchId, days = 30, limit = 10 }) {
  const now = new Date();
  const until = new Date(Date.now() + days * 86400000);

  const match = {
    tenantId,
    expiryDate: { $gte: now, $lte: until },
    qty: { $gt: 0 },
  };
  if (branchId) match.branchId = branchId;

  const rows = await Batch.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'drugs',
        localField: 'drugId',
        foreignField: '_id',
        as: 'drug',
      },
    },
    { $unwind: { path: '$drug', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        name: { $ifNull: ['$drug.name', 'Unknown'] },
        qty: 1,
        expiryDate: 1,
      },
    },
    { $sort: { expiryDate: 1 } },
    { $limit: limit },
  ]);

  return rows;
}

async function buildTenantContext({ tenantId, branchId = null, windowDays = DEFAULT_WINDOW_DAYS }) {
  if (!tenantId) throw new Error('buildTenantContext: tenantId required');

  return runAsTenant({ tenantId: String(tenantId) }, async () => {
    const tenant = await loadTenant(tenantId);
    if (!tenant) throw new Error('TENANT_NOT_FOUND');

    const plan = await loadPlan(tenant.planCode);
    const branch = await loadBranch({ tenantId, branchId });

    const [sales, topDrugs, lowStock, expiring] = await Promise.all([
      loadSalesSummary({ tenantId, branchId, days: windowDays }),
      loadTopDrugs({ tenantId, branchId, days: windowDays }),
      loadLowStock({ tenantId, branchId }),
      loadExpiring({ tenantId, branchId }),
    ]);

    const currency = plan?.price?.currency || 'KES';

    const lines = [
      `You are PharmaSys AI, an assistant for ${tenant.name}, a pharmacy in ${tenant.country}.`,
      '',
      'Current context:',
      `- Branch: ${branch.name}`,
      `- Period: last ${windowDays} days`,
      `- Sales: ${currency} ${Math.round(sales.total)} across ${sales.count} transactions`,
    ];

    if (topDrugs.length) {
      lines.push(`- Top drugs: ${topDrugs.map((d) => `${d.name} (${d.qty})`).join(', ')}`);
    }
    if (lowStock.length) {
      lines.push(`- Low stock: ${lowStock.map((d) => `${d.name} (${d.qty})`).join(', ')}`);
    }
    if (expiring.length) {
      lines.push(`- Expiring soon: ${expiring.map((d) => `${d.name} (${d.qty})`).join(', ')}`);
    }
    lines.push(`- Plan: ${plan?.name || tenant.planCode} · Branches: ${branch.multi ? 'multiple' : '1'}`);

    lines.push(
      '',
      'Answer concisely in plain English. Use only the data above.',
      'Never invent drug names, dosages, or prices. Never provide medical advice.',
      'For any medical query, reply: "Please consult a licensed pharmacist."'
    );

    return {
      systemPrompt: lines.join('\n'),
      context: {
        tenantId: String(tenant._id),
        tenantName: tenant.name,
        country: tenant.country,
        planName: plan?.name || tenant.planCode,
        planCode: tenant.planCode,
        branch: { name: branch.name, code: branch.code, multi: branch.multi },
        currency,
        windowDays,
        sales,
        topDrugs,
        lowStock,
        expiring,
      },
    };
  });
}

/* ═══════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════ */

module.exports = {
  buildLandingContext,
  buildTenantContext,
  loadSalesSummary,
  loadTopDrugs,
  loadLowStock,
  loadExpiring,
};