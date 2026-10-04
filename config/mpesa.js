const { env } = require('./env');

const config = {
  mode: env.mpesa.env,
  baseUrl: env.mpesa.baseUrl,

  consumerKey: env.mpesa.consumerKey,
  consumerSecret: env.mpesa.consumerSecret,
  shortcode: env.mpesa.shortcode,
  tillNumber: env.mpesa.tillNumber,
  passkey: env.mpesa.passkey,

  transactionType: env.mpesa.transactionType,
  isTill: env.mpesa.transactionType === 'CustomerBuyGoodsOnline',
  isPaybill: env.mpesa.transactionType === 'CustomerPayBillOnline',

  partyB: env.mpesa.transactionType === 'CustomerBuyGoodsOnline'
    ? env.mpesa.tillNumber
    : env.mpesa.shortcode,

  callbackUrl: env.mpesa.callbackUrl,
};

config.enabled = Boolean(
  config.consumerKey &&
  config.consumerSecret &&
  config.shortcode &&
  config.passkey &&
  config.callbackUrl
);

module.exports = { mpesaConfig: config };