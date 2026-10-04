const mongoose = require('mongoose');
const { ApiError } = require('./apiError');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function assertObjectId(id, label = 'id') {
  if (!isValidObjectId(id)) {
    throw ApiError.badRequest('INVALID_ID', `Invalid ${label}`);
  }
}

module.exports = { isValidObjectId, assertObjectId };