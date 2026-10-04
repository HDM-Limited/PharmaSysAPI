const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { env } = require('../../config/env');

const schema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true },
    role: { type: String, enum: ['super_admin'], default: 'super_admin' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    lastLoginAt: { type: Date, default: null },
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false, default: null },
  },
  { timestamps: true }
);

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
    delete ret.twoFactorSecret;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('SuperAdmin', schema);