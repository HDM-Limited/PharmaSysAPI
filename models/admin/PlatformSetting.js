const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin', default: null },
  },
  { timestamps: true }
);

schema.statics.getValue = async function (key, fallback = null) {
  const doc = await this.findOne({ key }).lean();
  return doc ? doc.value : fallback;
};

schema.statics.setValue = async function (key, value, adminId = null) {
  return this.findOneAndUpdate(
    { key },
    { key, value, updatedBy: adminId },
    { upsert: true, new: true }
  );
};

schema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('PlatformSetting', schema);