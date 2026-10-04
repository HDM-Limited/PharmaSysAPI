const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/legalController');

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.get);
router.post('/:id/set-current', ctrl.setCurrent);

module.exports = router;