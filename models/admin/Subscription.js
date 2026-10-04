const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    planCode: { type: String, required: true },
    cycle: { type: String, enum: ['once', 'month', 'year'], default: 'month' },
    currency: { type: String, default: 'KES' },
    amountMinor: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['active', 'pending', 'past_due', 'expired', 'cancelled', 'perpetual'],
      default: 'active',
    },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    autoRenew: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
    cancelledReason: { type: String, default: null },
    lastRenewalAt: { type: Date, default: null },
    renewalCount: { type: Number, default: 0 },
    stripeSubscriptionId: { type: String, default: null },
    stripeCustomerId: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, createdAt: -1 });
schema.index({ status: 1, periodEnd: 1 });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Subscription', schema);