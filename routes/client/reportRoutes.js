const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/reportController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/sales-daily', authorize('reports.branch'), ctrl.salesDaily);
router.get('/sales-range', authorize('reports.branch'), ctrl.salesRange);
router.get('/top-drugs', authorize('reports.branch'), ctrl.topDrugs);
router.get('/expiry-loss', authorize('reports.branch'), ctrl.expiryLoss);
router.get('/tax', authorize('reports.branch'), ctrl.tax);

module.exports = router;