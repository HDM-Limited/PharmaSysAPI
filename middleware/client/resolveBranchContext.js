const { runAsTenant } = require('../../models/plugins/context');

function resolveBranchContext(req, _res, next) {
  req.branchId = null;

  if (req.user?.role && req.user.role !== 'owner') {
    const first = req.branchIds?.[0];
    req.branchId = first ? String(first) : null;
  }

  const ctx = {
    tenantId: req.tenantId ? String(req.tenantId) : null,
    userId: req.user?._id ? String(req.user._id) : null,
    role: req.user?.role || null,
    branchIds: (req.branchIds || []).map(String),
    branchId: req.branchId,
  };

  runAsTenant(ctx, () => next());
}

module.exports = resolveBranchContext;