const { ApiError } = require('../../utils/apiError');

/* ═══════════════════════════════════════════════════════════
   PERMISSION MAP — mirrors what the client's
   utils/permissions.ts implements for UI gating.
   ═══════════════════════════════════════════════════════════ */

const OWNER_PERMISSIONS = [
  'branches.create',
  'branches.edit',
  'branches.view.all',
  'branches.view.own',

  'users.invite.manager',
  'users.invite.cashier',
  'users.view',
  'users.update',
  'users.remove',

  'drugs.create',
  'drugs.edit',
  'drugs.view',

  'inventory.receive',
  'inventory.adjust',
  'inventory.view',

  'sales.create',
  'sales.refund',
  'sales.void',

  'patients.view',
  'patients.create',
  'patients.update',

  'prescriptions.view',
  'prescriptions.dispense',

  'reports.branch',
  'reports.tenant',

  'suppliers.view',
  'suppliers.manage',

  'purchase_orders.view',
  'purchase_orders.create',
  'purchase_orders.receive',

  'customers.view',
  'customers.create',
  'customers.update',

  'settings.edit',
  'billing.manage',
  'ai.use',
];

const BRANCH_MANAGER_PERMISSIONS = [
  'branches.view.own',

  'users.invite.cashier',
  'users.view',
  'users.update',

  'drugs.view',

  'inventory.receive',
  'inventory.adjust',
  'inventory.view',

  'sales.create',
  'sales.refund',
  'sales.void',

  'patients.view',
  'patients.create',
  'patients.update',

  'prescriptions.view',
  'prescriptions.dispense',

  'reports.branch',

  'suppliers.view',

  'purchase_orders.view',
  'purchase_orders.create',
  'purchase_orders.receive',

  'customers.view',
  'customers.create',
  'customers.update',

  'ai.use',
];

const CASHIER_PERMISSIONS = [
  'drugs.view',
  'inventory.view',

  'sales.create',

  'patients.view',
  'patients.create',

  'customers.view',
  'customers.create',
  'customers.update',
];

const ROLE_PERMISSIONS = {
  owner: OWNER_PERMISSIONS,
  branch_manager: BRANCH_MANAGER_PERMISSIONS,
  cashier: CASHIER_PERMISSIONS,
};

/* ═══════════════════════════════════════════════════════════
   MIDDLEWARE
   ═══════════════════════════════════════════════════════════ */

function authorize(permission) {
  return (req, _res, next) => {
    const role = req.user?.role;

    if (!role) {
      return next(ApiError.unauthorized('NO_ROLE', 'User role not found on request'));
    }

    const allowed = ROLE_PERMISSIONS[role];
    if (!allowed) {
      return next(ApiError.forbidden('UNKNOWN_ROLE', `Unknown role: ${role}`));
    }

    if (!allowed.includes(permission)) {
      return next(
        ApiError.forbidden('FORBIDDEN', `Missing permission: ${permission}`)
      );
    }

    next();
  };
}

function hasPermission(role, permission) {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

module.exports = {
  authorize,
  hasPermission,
  ROLE_PERMISSIONS,
};