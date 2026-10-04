const axios = require('axios');
const { mpesaConfig } = require('../config/mpesa');
const { logger } = require('../utils/logger');

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 30_000) return cachedToken;

  const url = `${mpesaConfig.baseUrl}/oauth/v1/generate?grant_type=client_credentials`;
  const auth = Buffer.from(
    `${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`
  ).toString('base64');

  const { data } = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` },
  });

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + Number(data.expires_in || 3599) * 1000;
  return cachedToken;
}

function buildTimestamp() {
  return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
}

function buildPassword(timestamp) {
  return Buffer.from(
    `${mpesaConfig.shortcode}${mpesaConfig.passkey}${timestamp}`
  ).toString('base64');
}

async function initiateStkPush({ phone, amount, accountReference, description }) {
  if (!mpesaConfig.enabled) throw new Error('MPESA_NOT_CONFIGURED');

  const token = await getAccessToken();
  const timestamp = buildTimestamp();
  const password = buildPassword(timestamp);

  const payload = {
    BusinessShortCode: mpesaConfig.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: mpesaConfig.transactionType,
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: mpesaConfig.partyB,
    PhoneNumber: phone,
    CallBackURL: mpesaConfig.callbackUrl,
    AccountReference: accountReference,
    TransactionDesc: description || 'PharmaSys payment',
  };

  const { data } = await axios.post(
    `${mpesaConfig.baseUrl}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
}

async function queryStkStatus({ checkoutRequestId }) {
  const token = await getAccessToken();
  const timestamp = buildTimestamp();
  const password = buildPassword(timestamp);

  const { data } = await axios.post(
    `${mpesaConfig.baseUrl}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: mpesaConfig.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
}

function parseCallback(payload) {
  try {
    const stk = payload?.Body?.stkCallback;
    if (!stk) return { success: false, resultDesc: 'Malformed callback' };

    const resultCode = Number(stk.ResultCode);
    const success = resultCode === 0;

    const items = stk.CallbackMetadata?.Item || [];
    const get = (name) => items.find((i) => i.Name === name)?.Value ?? null;

    return {
      success,
      resultCode,
      resultDesc: stk.ResultDesc,
      checkoutRequestId: stk.CheckoutRequestID,
      merchantRequestId: stk.MerchantRequestID,
      amount: get('Amount'),
      mpesaReceiptNumber: get('MpesaReceiptNumber'),
      transactionDate: get('TransactionDate'),
      phoneNumber: get('PhoneNumber'),
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'mpesa parseCallback failed');
    return { success: false, resultDesc: 'Parse failed' };
  }
}

module.exports = {
  getAccessToken,
  initiateStkPush,
  queryStkStatus,
  parseCallback,
  enabled: () => mpesaConfig.enabled,
};