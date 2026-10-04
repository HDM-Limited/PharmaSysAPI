const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

/* ═══════════════════════════════════════════════════════════
   AiInsight — cached AI results per tenant (and optional branch)
   ═══════════════════════════════════════════════════════════ */

const INSIGHT_TYPES = [
  'weekly_insight',
  'stock_forecast',
  'expiry_risk',
  'reorder_suggestion',
];

const insightSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: INSIGHT_TYPES,
      required: true,
    },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    payload: { type: Object, default: {} },
    confidence: { type: Number, default: null },
    model: { type: String, default: null },
    generatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

insightSchema.index({ tenantId: 1, branchId: 1, type: 1, createdAt: -1 });
insightSchema.index({ tenantId: 1, type: 1, expiresAt: -1 });
insightSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

insightSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

insightSchema.plugin(tenantScope);

/* ═══════════════════════════════════════════════════════════
   AiCall — log of every AI request (tenant, branch, or public)
   ═══════════════════════════════════════════════════════════ */

const CALL_FEATURES = [
  'landing_chat',
  'chat',
  'insights',
  'forecast',
  'expiry_risk',
  'reorder',
  'summarize',
  'anomaly',
];

const callSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    feature: {
      type: String,
      enum: CALL_FEATURES,
      required: true,
      index: true,
    },
    promptHash: { type: String, default: null, index: true },
    promptPreview: { type: String, default: null },
    tokensUsed: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    provider: { type: String, default: 'HDM AI' },
    model: { type: String, default: null },
    success: { type: Boolean, default: true },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

callSchema.index({ tenantId: 1, createdAt: -1 });
callSchema.index({ tenantId: 1, feature: 1, createdAt: -1 });
callSchema.index({ tenantId: 1, success: 1, createdAt: -1 });

callSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

/* ═══════════════════════════════════════════════════════════
   NOTE ON AiCall + tenantScope
   ═══════════════════════════════════════════════════════════
   AiCall intentionally does NOT use tenantScope plugin.
   Reason:
     - Landing chat writes AiCall with tenantId: null
     - Schedulers write AiCall inside admin context
     - Service queries use `__allowGlobal: true`
   Tenant isolation is enforced at the service layer.
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   MODELS
   ═══════════════════════════════════════════════════════════ */

const AiInsight = mongoose.model('AiInsight', insightSchema);
const AiCall = mongoose.model('AiCall', callSchema);

module.exports = { AiInsight, AiCall };