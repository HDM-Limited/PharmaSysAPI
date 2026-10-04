const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/customerController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/', authorize('customers.view'), ctrl.list);
router.post('/', authorize('customers.create'), ctrl.create);
router.get('/:id', authorize('customers.view'), ctrl.get);
router.patch('/:id', authorize('customers.update'), ctrl.update);
router.delete('/:id', authorize('customers.update'), ctrl.remove);
router.get('/:id/purchases', authorize('customers.view'), ctrl.purchases);

module.exports = router;