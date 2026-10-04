const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    licenseNo: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    clinic: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, name: 'text' });
schema.index({ tenantId: 1, licenseNo: 1 }, { sparse: true });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

schema.plugin(tenantScope);

module.exports = mongoose.model('Doctor', schema);