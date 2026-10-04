const mongoose = require('mongoose');

const SCOPES = ['tenant', 'admin', 'system'];

const schema = new mongoose.Schema(
  {
    scope: { type: String, enum: SCOPES, default: 'tenant', index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    recipientId: { type: mongoose.Schema.Types.ObjectId, default: null },
    channel: { type: String, enum: ['sms', 'email'], required: true },
    template: { type: String, required: true },
    to: { type: String, required: true },
    subject: { type: String, default: null },
    body: { type: String, default: null },
    status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
    providerMessageId: { type: String, default: null },
    creditsUsed: { type: Number, default: 0 },
    error: { type: String, default: null },
    errorCode: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, createdAt: -1 });
schema.index({ scope: 1, createdAt: -1 });
schema.index({ tenantId: 1, channel: 1, status: 1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Notification', schema);