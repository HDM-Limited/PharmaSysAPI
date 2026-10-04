const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/settingsController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/', ctrl.get);
router.patch('/', authorize('settings.edit'), ctrl.update);

module.exports = router;