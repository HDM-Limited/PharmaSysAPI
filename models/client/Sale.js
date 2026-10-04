const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

const itemSchema = new mongoose.Schema(
  {
    drugId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drug', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    name: { type: String, default: null },
    qty: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    total: { type: Number, required: true },
  },
  { _id: true }
);

const returnItemSchema = new mongoose.Schema(
  {
    saleItemIndex: { type: Number, required: true },
    drugId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drug', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    qty: { type: Number, required: true },
    refundAmount: { type: Number, required: true },
  },
  { _id: true }
);

const returnSchema = new mongoose.Schema(
  {
    items: { type: [returnItemSchema], default: [] },
    reason: { type: String, default: null },
    refundAmount: { type: Number, default: 0 },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    processedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
    },
    note: { type: String, default: null },
  },
  { _id: true, timestamps: true }
);

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    invoiceNo: { type: String, required: true },
    cashierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [itemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    paymentMethod: {
      type: String,
      enum: ['cash', 'mpesa', 'card', 'insurance'],
      default: 'cash',
    },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    prescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription', default: null },
    status: {
      type: String,
      enum: ['completed', 'partially_refunded', 'refunded', 'voided'],
      default: 'completed',
    },
    returns: { type: [returnSchema], default: [] },
    receiptPublicId: { type: String, default: null },
    receiptUrl: { type: String, default: null },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, branchId: 1, createdAt: -1 });
schema.index({ tenantId: 1, invoiceNo: 1 }, { unique: true });
schema.index({ tenantId: 1, patientId: 1, createdAt: -1 });
schema.index({ tenantId: 1, customerId: 1, createdAt: -1 });

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

schema.plugin(tenantScope, { branchScoped: true });

module.exports = mongoose.model('Sale', schema);