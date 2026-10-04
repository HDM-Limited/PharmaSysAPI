const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/patientController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/', authorize('patients.view'), ctrl.list);
router.post('/', authorize('patients.create'), ctrl.create);
router.get('/:id', authorize('patients.view'), ctrl.get);
router.patch('/:id', authorize('patients.update'), ctrl.update);
router.delete('/:id', authorize('patients.update'), ctrl.remove);
router.get('/:id/sales', authorize('patients.view'), ctrl.sales);
router.get('/:id/prescriptions', authorize('patients.view'), ctrl.prescriptions);

module.exports = router;