'use strict';

const { mockPaymentProvider } = require('./mock.provider');

/**
 * Payment provider registry (Phase 13).
 * Real gateways (Razorpay/PayU/Stripe/…) register here later without
 * changing Booking business logic.
 */
const providers = new Map([[mockPaymentProvider.code, mockPaymentProvider]]);

function getPaymentProvider(code = 'APL_MOCK_PAY') {
  const provider = providers.get(String(code || 'APL_MOCK_PAY'));
  if (!provider) {
    throw new Error(`Unknown payment provider: ${code}`);
  }
  return provider;
}

function registerPaymentProvider(provider) {
  if (!provider?.code) throw new Error('provider.code required');
  if (typeof provider.createPayment !== 'function') {
    throw new Error('provider.createPayment required');
  }
  if (typeof provider.refundPayment !== 'function') {
    throw new Error('provider.refundPayment required');
  }
  providers.set(provider.code, provider);
  return provider;
}

module.exports = { getPaymentProvider, registerPaymentProvider };
