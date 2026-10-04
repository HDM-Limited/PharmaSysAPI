const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

const TYPES = [
  'info',
  'success',
  'warning',
  'error',
  'sale',
  'inventory',
  'prescription',
  'subscription',
  'system',
];

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    type: { type: String, enum: TYPES, default: 'info' },
    title: { type: String, required: true },
    body: { type: String, default: null },
    icon: { type: String, default: null },
    link: { type: String, default: null },
    meta: { type: Object, default: {} },
    readAt: { type: Date, default: null },
    seen: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, userId: 1, createdAt: -1 });
schema.index({ tenantId: 1, userId: 1, readAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

schema.plugin(tenantScope);

module.exports = mongoose.model('AppNotification', schema);