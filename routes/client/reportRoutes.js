const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/reportController');
const { authorize } = require('../../middleware/client/authorize');

/* Sales */
router.get('/sales-daily', authorize('reports.branch'), ctrl.salesDaily);
router.get('/sales-range', authorize('reports.branch'), ctrl.salesRange);
router.get('/top-drugs', authorize('reports.branch'), ctrl.topDrugs);

/* Inventory */
router.get('/inventory-stock', authorize('reports.branch'), ctrl.inventoryStock);

/* Customers */
router.get('/customers-top', authorize('reports.branch'), ctrl.customersTop);

/* Patients */
router.get('/patients-demographics', authorize('reports.branch'), ctrl.patientsDemographics);

/* Staff */
router.get('/staff-summary', authorize('reports.branch'), ctrl.staffSummary);

/* General */
router.get('/expiry-loss', authorize('reports.branch'), ctrl.expiryLoss);
router.get('/tax', authorize('reports.branch'), ctrl.tax);

module.exports = router;