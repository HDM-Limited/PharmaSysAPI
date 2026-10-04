const express = require('express');
const router = express.Router();

const authenticateAdmin = require('../../middleware/admin/authenticateAdmin');
const requireSuperAdmin = require('../../middleware/admin/requireSuperAdmin');
const logAdminAction = require('../../middleware/admin/logAdminAction');

router.use('/auth', require('./authRoutes'));

router.use(authenticateAdmin);
router.use(requireSuperAdmin);
router.use(logAdminAction);

router.use('/tenants', require('./tenantRoutes'));
router.use('/plans', require('./planRoutes'));
router.use('/pending', require('./pendingRoutes'));
router.use('/payments', require('./paymentRoutes'));
router.use('/invoices', require('./invoiceRoutes'));
router.use('/payment-methods', require('./paymentMethodRoutes'));
router.use('/settings', require('./settingsRoutes'));
router.use('/downloads', require('./downloadsRoutes'));
router.use('/audit-logs', require('./auditRoutes'));
router.use('/health', require('./healthRoutes'));
router.use('/backups', require('./backupRoutes'));
router.use('/legal', require('./legalRoutes'));

module.exports = router;