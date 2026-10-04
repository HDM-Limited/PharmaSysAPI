const mongoose = require('mongoose');

const STATUSES = ['pending', 'in_review', 'approved', 'rejected', 'expired'];
const PRIORITIES = ['normal', 'high', 'low'];

const schema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true,
    },
    status: { type: String, enum: STATUSES, default: 'pending' },
    priority: { type: String, enum: PRIORITIES, default: 'normal' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin', default: null },
    registeredAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin', default: null },
    decision: {
      type: String,
      enum: ['approved', 'rejected', 'expired', null],
      default: null,
    },
    rejectionReason: { type: String, default: null },
    notes: { type: String, default: null },
    slaDeadline: { type: Date, default: null },
    escalated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

schema.index({ status: 1, priority: -1, registeredAt: 1 });
schema.index({ assignedTo: 1, status: 1 });
schema.index({ slaDeadline: 1 });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('PendingActivation', schema);