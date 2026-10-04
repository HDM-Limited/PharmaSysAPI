const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/public/authController');
const authenticateTenant = require('../../middleware/client/authenticateTenant');

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout', ctrl.logout);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/reset-password', ctrl.resetPassword);
router.post('/accept-invite', ctrl.acceptInvite);
router.post('/impersonate-exchange', ctrl.impersonateExchange);

router.get('/me', authenticateTenant, ctrl.me);

module.exports = router;