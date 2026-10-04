const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { env } = require('../../config/env');
const { tenantScope } = require('../plugins/tenantScope');

const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    branchIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Branch', default: [] },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, default: null },
    role: { type: String, enum: ['owner', 'branch_manager', 'cashier'], required: true },
    status: {
      type: String,
      enum: ['active', 'pending', 'suspended', 'rejected'],
      default: 'pending',
    },
    mustChangePassword: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    verifyToken: { type: String, select: false, default: null },
    verifyExpiresAt: { type: Date, select: false, default: null },
    resetToken: { type: String, select: false, default: null },
    resetExpiresAt: { type: Date, select: false, default: null },
    lastLoginAt: { type: Date, default: null },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

schema.index({ tenantId: 1, email: 1 }, { unique: true });
schema.index({ tenantId: 1, branchIds: 1 });
schema.index({ tenantId: 1, role: 1 });

schema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

schema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  if (this.passwordHash.startsWith('$2')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, env.bcryptRounds);
  next();
});

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.verifyToken;
    delete ret.resetToken;
    delete ret.__v;
    return ret;
  },
});

schema.plugin(tenantScope);

module.exports = mongoose.model('User', schema);