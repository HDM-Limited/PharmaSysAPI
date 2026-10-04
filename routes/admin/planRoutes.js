const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/planController');

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.get);
router.patch('/:id', ctrl.update);
router.post('/:id/deactivate', ctrl.deactivate);
router.delete('/:id', ctrl.remove);

module.exports = router;