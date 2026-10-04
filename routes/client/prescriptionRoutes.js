const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/prescriptionController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/', authorize('prescriptions.view'), ctrl.list);
router.post('/', authorize('prescriptions.view'), ctrl.create);
router.get('/:id', authorize('prescriptions.view'), ctrl.get);
router.patch('/:id', authorize('prescriptions.view'), ctrl.update);
router.post('/:id/dispense', authorize('prescriptions.dispense'), ctrl.dispense);

module.exports = router;