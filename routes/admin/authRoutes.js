const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/authController');
const authenticateAdmin = require('../../middleware/admin/authenticateAdmin');

router.post('/login', ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout', authenticateAdmin, ctrl.logout);
router.get('/me', authenticateAdmin, ctrl.me);

module.exports = router;