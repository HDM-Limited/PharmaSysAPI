const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/supplierController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/', authorize('suppliers.view'), ctrl.list);
router.post('/', authorize('suppliers.manage'), ctrl.create);
router.get('/:id', authorize('suppliers.view'), ctrl.get);
router.patch('/:id', authorize('suppliers.manage'), ctrl.update);
router.delete('/:id', authorize('suppliers.manage'), ctrl.remove);

module.exports = router;