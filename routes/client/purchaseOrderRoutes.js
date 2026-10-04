const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/purchaseOrderController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/', authorize('purchase_orders.view'), ctrl.list);
router.post('/', authorize('purchase_orders.create'), ctrl.create);
router.get('/:id', authorize('purchase_orders.view'), ctrl.get);
router.post('/:id/receive', authorize('purchase_orders.receive'), ctrl.receive);
router.post('/:id/cancel', authorize('purchase_orders.create'), ctrl.cancel);
router.delete('/:id', authorize('purchase_orders.create'), ctrl.remove);

module.exports = router;