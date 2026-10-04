const mongoose = require('mongoose');
const { tenantScope } = require('../plugins/tenantScope');

const itemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, default: null },
    name: { type: String, required: true },
    description: { type: String, default: null },
    qty: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
  },
  { _id: true }
);

const STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
const PURPOSES = ['registration', 'renewal', 'upgrade', 'sale'];

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    invoiceNumber: { type: String, required: true },
    purpose: { type: String, enum: PURPOSES, default: 'registration', index: true },
    planCode: { type: String, default: null },
    customerId: { type: mongoose.Schema.Types.ObjectId, default: null },
    customerSnapshot: {
      name: { type: String, default: null },
      email: { type: String, default: null },
      phone: { type: String, default: null },
      address: { type: String, default: null },
    },
    items: { type: [itemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    amountDue: { type: Number, default: 0 },
    currency: { type: String, default: 'KES' },
    status: { type: String, enum: STATUSES, default: 'sent' },
    paymentMethod: { type: String, default: null },
    paymentRef: { type: String, default: null },
    dueDate: { type: Date, default: null },
    issuedAt: { type: Date, default: Date.now },
    sentAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null, index: true },                       // ← new
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin', default: null }, // ← new
    notes: { type: String, default: null },
    paymentInstructions: { type: [Object], default: [] },
    stkLastRequest: {
      checkoutRequestId: { type: String, default: null },
      phone: { type: String, default: null },
      requestedAt: { type: Date, default: null },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, invoiceNumber: 1 }, { unique: true });
schema.index({ tenantId: 1, status: 1, createdAt: -1 });
schema.index({ tenantId: 1, purpose: 1, createdAt: -1 });
schema.index({ purpose: 1, approvedAt: 1, status: 1 });                            // ← new

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

schema.plugin(tenantScope);

module.exports = mongoose.model('Invoice', schema);