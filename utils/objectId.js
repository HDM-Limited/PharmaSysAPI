const mongoose = require('mongoose');

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
}

function toObjectIds(values) {
  if (!Array.isArray(values)) return [];
  return values.filter(Boolean).map(toObjectId);
}

module.exports = { toObjectId, toObjectIds };