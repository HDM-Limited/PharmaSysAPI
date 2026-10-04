const mongoose = require('mongoose');

const STATUSES = ['pending_user', 'active', 'rejected', 'suspended', 'expired', 'deleted'];
const BUSINESS_TYPES = ['retail', 'restaurant', 'salon', 'pharmacy', 'other'];

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    country: { type: String, required: true, default: 'KE' },
    businessType: { type: String, enum: BUSINESS_TYPES, default: 'pharmacy' },
    status: { type: String, enum: STATUSES, default: 'pending_user' },
    planCode: { type: String, default: 'free' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    registeredAt: { type: Date, default: Date.now },
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
    rejectedAt: Date,
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
    rejectionReason: String,
    suspendedAt: Date,
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
    suspendedReason: String,
    expiresAt: Date,
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
    settings: { type: Object, default: {} },
  },
  { timestamps: true }
);

schema.index({ status: 1 });
schema.index({ status: 1, registeredAt: -1 });
schema.index({ country: 1 });
schema.index({ status: 1, expiresAt: 1 });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Tenant', schema);