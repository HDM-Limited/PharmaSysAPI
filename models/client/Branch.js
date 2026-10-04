const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    address: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, code: 1 }, { unique: true });
schema.index({ tenantId: 1, isActive: 1 });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

schema.plugin(tenantScope);

module.exports = mongoose.model('Branch', schema);