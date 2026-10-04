const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

const FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'injection', 'cream', 'ointment', 'drops', 'inhaler', 'other'];

const drugSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    generic: { type: String, default: null },
    brand: { type: String, default: null },
    barcode: { type: String, default: null },
    category: { type: String, default: null },
    form: { type: String, enum: FORMS, default: 'tablet' },
    strength: { type: String, default: null },
    unit: { type: String, default: 'pcs' },
    taxRate: { type: Number, default: 0 },
    reorderLevel: { type: Number, default: 10 },
    prescriptionRequired: { type: Boolean, default: false },
    controlled: { type: Boolean, default: false },
    imagePublicId: { type: String, default: null },
    imageUrl: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

drugSchema.index({ tenantId: 1, barcode: 1 }, { unique: true, sparse: true });
drugSchema.index({ tenantId: 1, name: 'text' });
drugSchema.index({ tenantId: 1, isActive: 1 });

drugSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

drugSchema.plugin(tenantScope);

const batchSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    drugId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drug', required: true, index: true },
    lotNo: { type: String, default: null },
    qty: { type: Number, required: true, default: 0 },
    costPrice: { type: Number, default: 0 },
    sellingPrice: { type: Number, default: 0 },
    expiryDate: { type: Date, required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

batchSchema.index({ tenantId: 1, branchId: 1, drugId: 1, expiryDate: 1 });
batchSchema.index({ tenantId: 1, expiryDate: 1 });

batchSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

batchSchema.plugin(tenantScope, { branchScoped: true });

const movementSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    drugId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drug', required: true, index: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
    type: {
      type: String,
      enum: ['in', 'out', 'adjust', 'expired', 'returned'],
      required: true,
    },
    qty: { type: Number, required: true },
    ref: { type: String, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: null },
  },
  { timestamps: true }
);

movementSchema.index({ tenantId: 1, branchId: 1, drugId: 1, createdAt: -1 });

movementSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

movementSchema.plugin(tenantScope, { branchScoped: true });

const Drug = mongoose.model('Drug', drugSchema);
const Batch = mongoose.model('Batch', batchSchema);
const StockMovement = mongoose.model('StockMovement', movementSchema);

module.exports = { Drug, Batch, StockMovement };