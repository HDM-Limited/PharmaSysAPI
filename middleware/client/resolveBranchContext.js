const { runAsTenant } = require('../../models/plugins/context');

/**
 * Resolves the branch context for the request.
 *
 *   - Owners: honor explicit `X-Branch-Id` header when it's a branch they own.
 *             Otherwise null → "all branches" (aggregations sum across branches).
 *   - Non-owners: pinned to their first assigned branch.
 *
 * Both cases feed the same AsyncLocalStorage context so downstream
 * tenant-scoped models filter correctly.
 */
function resolveBranchContext(req, _res, next) {
  req.branchId = null;

  if (req.user?.role === 'owner') {
    const headerBranch = req.headers['x-branch-id'];
    if (headerBranch && req.branchIds?.includes(String(headerBranch))) {
      req.branchId = String(headerBranch);
    }
  } else {
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