const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/settingsController');

router.post('/sign', ctrl.signUpload);

module.exports = router;