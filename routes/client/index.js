const express = require('express');
const router = express.Router();

const authenticateTenant = require('../../middleware/client/authenticateTenant');
const resolveBranchContext = require('../../middleware/client/resolveBranchContext');
const requireScope = require('../../middleware/client/requireScope');

router.use(authenticateTenant);
router.use(resolveBranchContext);
router.use(requireScope('active'));

router.use('/dashboard', require('./dashboardRoutes'));
router.use('/branches', require('./branchRoutes'));
router.use('/users', require('./userRoutes'));
router.use('/customers', require('./customerRoutes'));
router.use('/inventory', require('./inventoryRoutes'));
router.use('/sales', require('./saleRoutes'));
router.use('/patients', require('./patientRoutes'));
router.use('/prescriptions', require('./prescriptionRoutes'));
router.use('/suppliers', require('./supplierRoutes'));
router.use('/purchase-orders', require('./purchaseOrderRoutes'));
router.use('/reports', require('./reportRoutes'));
router.use('/settings', require('./settingsRoutes'));
router.use('/notifications', require('./notificationRoutes'));
router.use('/ai', require('./aiRoutes'));
router.use('/billing', require('./billingRoutes'));
router.use('/uploads', require('./uploadRoutes'));

module.exports = router;