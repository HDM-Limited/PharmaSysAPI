const Stripe = require('stripe');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');

let stripe = null;
if (env.stripe.secret) {
  stripe = new Stripe(env.stripe.secret, { apiVersion: '2024-06-20' });
}

function ensure() {
  if (!stripe) throw new Error('STRIPE_NOT_CONFIGURED');
  return stripe;
}

async function createCheckoutSession({
  tenantId,
  planCode,
  priceId,
  successUrl,
  cancelUrl,
  customerEmail,
}) {
  const s = ensure();
  return s.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail,
    metadata: { tenantId: String(tenantId), planCode },
  });
}

async function createBillingPortalSession({ customerId, returnUrl }) {
  const s = ensure();
  return s.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

function verifyWebhook(rawBody, signature) {
  const s = ensure();
  return s.webhooks.constructEvent(rawBody, signature, env.stripe.webhookSecret);
}

async function handleEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      logger.info({ type: event.type, id: event.id }, 'stripe event received');
      return { handled: true, type: event.type };
    default:
      return { handled: false, type: event.type };
  }
}

module.exports = {
  createCheckoutSession,
  createBillingPortalSession,
  verifyWebhook,
  handleEvent,
  enabled: () => Boolean(stripe),
};