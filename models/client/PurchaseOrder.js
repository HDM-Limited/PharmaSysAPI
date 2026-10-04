const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

const itemSchema = new mongoose.Schema(
  {
    drugId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drug', required: true },
    qty: { type: Number, required: true },
    costPrice: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: true }
);

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    poNo: { type: String, required: true },
    status: {
      type: String,
      enum: ['draft', 'ordered', 'received', 'cancelled'],
      default: 'draft',
    },
    items: { type: [itemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    notes: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, branchId: 1, status: 1, createdAt: -1 });
schema.index({ tenantId: 1, poNo: 1 }, { unique: true });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

schema.plugin(tenantScope, { branchScoped: true });

module.exports = mongoose.model('PurchaseOrder', schema);