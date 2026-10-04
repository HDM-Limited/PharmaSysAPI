const { asyncHandler } = require('../../utils/asyncHandler');
const { paginated } = require('../../utils/apiResponse');
const { parsePagination } = require('../../utils/pagination');
const adminActionService = require('../../services/adminActionService');

const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.adminId) filter.adminId = req.query.adminId;
  if (req.query.tenantId) filter.tenantId = req.query.tenantId;
  if (req.query.action) filter.action = req.query.action;

  const { items, total } = await adminActionService.list({ filter, page, limit, skip });
  return paginated(res, items, page, limit, total);
});

module.exports = { list };