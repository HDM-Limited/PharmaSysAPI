const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/settingsController');

router.get('/', ctrl.get);
router.patch('/', ctrl.update);
router.patch('/features', ctrl.updateFeatures);
router.get('/ai', ctrl.getAi);
router.patch('/ai', ctrl.updateAi);
router.post('/ai/test/:key', ctrl.testAiProvider);
router.get('/mpesa', ctrl.getMpesa);
router.patch('/mpesa', ctrl.updateMpesa);
router.get('/public', ctrl.getPublic);

module.exports = router;