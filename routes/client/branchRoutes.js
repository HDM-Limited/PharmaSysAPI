const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/branchController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/', ctrl.list);
router.post('/', authorize('branches.create'), ctrl.create);
router.get('/:id', ctrl.get);
router.patch('/:id', authorize('branches.edit'), ctrl.update);
router.post('/:id/deactivate', authorize('branches.edit'), ctrl.deactivate);

module.exports = router;