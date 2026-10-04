const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/saleController');
const { authorize } = require('../../middleware/client/authorize');

router.post('/', authorize('sales.create'), ctrl.create);
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/:id/refund', authorize('sales.refund'), ctrl.refund);
router.get('/:id/receipt.pdf', ctrl.receipt);

module.exports = router;