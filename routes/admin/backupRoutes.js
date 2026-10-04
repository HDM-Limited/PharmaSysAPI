const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/backupController');

router.get('/', ctrl.list);
router.post('/', ctrl.createNow);
router.get('/settings', ctrl.getSettings);
router.patch('/settings', ctrl.updateSettings);
router.get('/:id', ctrl.get);
router.get('/:id/download', ctrl.download);
router.post('/:id/send-email', ctrl.sendEmail);
router.post('/:id/restore', ctrl.restore);
router.delete('/:id', ctrl.remove);

module.exports = router;