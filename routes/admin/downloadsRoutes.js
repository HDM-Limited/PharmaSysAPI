const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/downloadsController');

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.post('/:id/toggle', ctrl.toggle);
router.post('/reorder', ctrl.reorder);
router.delete('/:id', ctrl.remove);

module.exports = router;