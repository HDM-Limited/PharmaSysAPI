const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

const PURPOSES = ['invoice', 'subscription', 'sale'];

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    purpose: { type: String, enum: PURPOSES, required: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    method: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'KES' },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'refunded'],
      default: 'pending',
    },
    providerRef: { type: String, default: null },
    mpesaReceipt: { type: String, default: null },
    stripePaymentIntentId: { type: String, default: null },
    failureReason: { type: String, default: null },
    providerPayload: { type: Object, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, providerRef: 1 }, { sparse: true });
schema.index({ tenantId: 1, status: 1, createdAt: -1 });
schema.index({ tenantId: 1, purpose: 1, createdAt: -1 });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

schema.plugin(tenantScope);

module.exports = mongoose.model('Payment', schema);