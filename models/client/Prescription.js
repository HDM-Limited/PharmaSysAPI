const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

const itemSchema = new mongoose.Schema(
  {
    drugId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drug', required: true },
    dosage: { type: String, default: null },
    duration: { type: String, default: null },
    qty: { type: Number, required: true },
    refills: { type: Number, default: 0 },
    notes: { type: String, default: null },
  },
  { _id: true }
);

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
    refNo: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'dispensed', 'partial', 'cancelled'],
      default: 'pending',
    },
    items: { type: [itemSchema], default: [] },
    dispensedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dispensedAt: { type: Date, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, branchId: 1, status: 1, createdAt: -1 });
schema.index({ tenantId: 1, patientId: 1, createdAt: -1 });
schema.index({ tenantId: 1, refNo: 1 }, { sparse: true });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

schema.plugin(tenantScope, { branchScoped: true });

module.exports = mongoose.model('Prescription', schema);