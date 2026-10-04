const express = require('express');
const router = express.Router();
const Plan = require('../../models/admin/Plan');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');

const list = asyncHandler(async (_req, res) => {
  const plans = await Plan.find({ isPublic: true, isActive: true })
    .sort({ sortOrder: 1 })
    .lean();
  return ok(res, plans);
});

router.get('/', list);

module.exports = router;