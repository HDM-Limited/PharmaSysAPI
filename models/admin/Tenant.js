const mongoose = require('mongoose');

const STATUSES = ['pending_user', 'active', 'rejected', 'suspended', 'expired'];

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    country: { type: String, required: true, default: 'KE' },
    businessType: { type: String, default: 'pharmacy' },
    status: { type: String, enum: STATUSES, default: 'pending_user' },
    planCode: { type: String, default: 'free' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    registeredAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin', default: null },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin', default: null },
    rejectionReason: { type: String, default: null },
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin', default: null },
    suspendedReason: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    branchMode: { type: String, enum: ['single', 'multi'], default: 'single' },
    settings: { type: Object, default: {} },
  },
  { timestamps: true }
);

schema.index({ status: 1, registeredAt: -1 });
schema.index({ country: 1 });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Tenant', schema);