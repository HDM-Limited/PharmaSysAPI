const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    dob: { type: Date, default: null },
    gender: { type: String, enum: ['male', 'female', 'other', null], default: null },
    allergies: { type: [String], default: [] },
    chronicConditions: { type: [String], default: [] },
    insurance: { type: Object, default: {} },
    notes: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, phone: 1 });
schema.index({ tenantId: 1, name: 'text' });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

schema.plugin(tenantScope);

module.exports = mongoose.model('Patient', schema);