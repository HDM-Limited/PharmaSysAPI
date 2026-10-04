const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/tenantController');

router.get('/', ctrl.list);
router.get('/:id/stats', ctrl.stats);
router.get('/:id', ctrl.get);
router.patch('/:id', ctrl.update);
router.post('/:id/suspend', ctrl.suspend);
router.post('/:id/reactivate', ctrl.reactivate);
router.post('/:id/impersonate', ctrl.impersonate);
router.delete('/:id', ctrl.remove);

module.exports = router;