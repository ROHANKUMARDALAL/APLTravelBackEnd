'use strict';

const crypto = require('crypto');
const { AppError } = require('../common/errors/app-error');
const { writeLifecycleLog } = require('../common/services/lifecycle-log.service');
const CustomerWallet = require('../customer/models/CustomerWallet');
const WalletTransaction = require('../customer/models/WalletTransaction');
const User = require('../user/models/User');
const CustomerWalletTopUp = require('./models/CustomerWalletTopUp');
const { quoteWalletTopUp, mockTopUpAllowed } = require('./wallet-topup-fee');

function newPaymentRef() {
  return `WTP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function sameMoney(left, right) {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

function assertQuoteMatch(quote, input = {}) {
  if (input.feeAmount != null && !sameMoney(input.feeAmount, quote.feeAmount)) {
    throw AppError.validation('Wallet fee does not match the selected method', [{
      field: 'feeAmount',
      requiredFee: quote.feeAmount,
      providedFee: Number(input.feeAmount),
    }]);
  }
  if (input.netAmount != null && !sameMoney(input.netAmount, quote.netCredit)) {
    throw AppError.validation('Wallet credit does not match the server calculation', [{
      field: 'netAmount',
      requiredNet: quote.netCredit,
      providedNet: Number(input.netAmount),
    }]);
  }
  if (input.paymentAmount != null && !sameMoney(input.paymentAmount, quote.paymentAmount)) {
    throw AppError.validation('Payment amount was changed', [{
      field: 'paymentAmount',
      requiredAmount: quote.paymentAmount,
    }]);
  }
}

function publicTopUp(doc, extra = {}) {
  return {
    paymentRef: doc.paymentRef,
    status: doc.status,
    method: doc.method,
    currency: doc.currency || 'INR',
    paymentAmount: doc.grossAmount,
    feeAmount: doc.feeAmount,
    netCredit: doc.netAmount,
    rateBps: doc.rateBps,
    provider: doc.provider || 'APL_MOCK_PAY',
    providerRef: doc.providerRef || '',
    demo: true,
    demoLabel: 'DEMO',
    failureReason: doc.failureReason || '',
    createdAt: doc.createdAt,
    ...extra,
  };
}

async function logWallet(entry) {
  await writeLifecycleLog({
    direction: 'INBOUND',
    supplierCode: 'APL_MOCK_PAY',
    service: 'WALLET',
    httpStatus: entry.status === 'FAILED' ? 400 : 200,
    ...entry,
  });
}

async function syncUserBalance(userId, balance) {
  await User.updateOne({ _id: userId }, { $set: { balance } });
}

async function creditNet(topUp) {
  const existing = await WalletTransaction.findOne({
    reference: topUp.paymentRef,
    type: 'ADD_MONEY',
  }).lean();
  if (existing) {
    const wallet = await CustomerWallet.findOne({ dsaId: topUp.dsaId, userId: topUp.userId }).lean();
    return { wallet, entry: existing, replay: true };
  }
  const wallet = await CustomerWallet.findOneAndUpdate(
    { dsaId: topUp.dsaId, userId: topUp.userId },
    {
      $inc: { balance: topUp.netAmount, totalCredits: topUp.netAmount },
      $setOnInsert: { currency: topUp.currency || 'INR', dsaId: topUp.dsaId, userId: topUp.userId },
    },
    { upsert: true, new: true },
  );
  try {
    const entry = await WalletTransaction.create({
      dsaId: topUp.dsaId,
      userId: topUp.userId,
      amount: topUp.netAmount,
      direction: 'CREDIT',
      type: 'ADD_MONEY',
      currency: topUp.currency || 'INR',
      reference: topUp.paymentRef,
      paymentRef: topUp.paymentRef,
      reason: 'Add Money',
      balanceAfter: wallet.balance,
      grossAmount: topUp.grossAmount,
      feeAmount: topUp.feeAmount,
      method: topUp.method,
      status: 'SUCCESS',
    });
    await syncUserBalance(topUp.userId, wallet.balance);
    return { wallet, entry, replay: false };
  } catch (error) {
    if (error && error.code === 11000) {
      await CustomerWallet.updateOne(
        { dsaId: topUp.dsaId, userId: topUp.userId },
        { $inc: { balance: -topUp.netAmount, totalCredits: -topUp.netAmount } },
      );
      const entry = await WalletTransaction.findOne({
        reference: topUp.paymentRef,
        type: 'ADD_MONEY',
      }).lean();
      const current = await CustomerWallet.findOne({ dsaId: topUp.dsaId, userId: topUp.userId }).lean();
      return { wallet: current, entry, replay: true };
    }
    throw error;
  }
}

function quotedFromInput(input) {
  let quote;
  try {
    quote = quoteWalletTopUp(input.amount, input.method);
  } catch (error) {
    throw AppError.validation(error.message || 'Invalid wallet top-up');
  }
  assertQuoteMatch(quote, input);
  return quote;
}

async function createCustomerTopUp({ userId, dsaId, input, idempotencyKey, requestId }) {
  if (!idempotencyKey) throw AppError.validation('Idempotency key is required');
  const quote = quotedFromInput(input);
  const existing = await CustomerWalletTopUp.findOne({ dsaId, userId, idempotencyKey });
  if (existing) {
    return { topUp: publicTopUp(existing), replay: true };
  }
  const doc = await CustomerWalletTopUp.create({
    dsaId,
    userId,
    paymentRef: newPaymentRef(),
    idempotencyKey: String(idempotencyKey).slice(0, 120),
    method: quote.method,
    currency: 'INR',
    grossAmount: quote.paymentAmount,
    feeAmount: quote.feeAmount,
    netAmount: quote.netCredit,
    rateBps: quote.rateBps,
    status: 'PENDING',
    provider: 'APL_MOCK_PAY',
    demo: true,
    requestId: requestId || '',
  });
  await logWallet({
    stage: 'PAYMENT_CREATED',
    operation: 'WALLET_ADD_MONEY',
    requestId,
    dsaId,
    userId,
    status: 'SUCCESS',
    request: { method: quote.method, paymentAmount: quote.paymentAmount, demo: true },
    result: { paymentRef: doc.paymentRef, feeAmount: quote.feeAmount, netCredit: quote.netCredit, status: 'PENDING' },
  });
  return { topUp: publicTopUp(doc), replay: false };
}

function verifyDemoPayment(outcome) {
  if (!mockTopUpAllowed()) {
    return { status: 'BLOCKED', reason: 'Live wallet top-up is disabled until a verified payment provider is connected' };
  }
  const value = String(outcome || 'SUCCESS').toUpperCase();
  if (value === 'FAILED' || value === 'FAIL') {
    return { status: 'FAILED', reason: 'Demo payment was declined' };
  }
  if (value === 'PENDING') {
    return { status: 'PENDING', reason: 'Demo payment is still pending' };
  }
  if (value !== 'SUCCESS') {
    return { status: 'FAILED', reason: 'Demo payment could not be verified' };
  }
  return { status: 'SUCCESS', providerRef: `MOCK-${crypto.randomBytes(4).toString('hex').toUpperCase()}` };
}

async function confirmCustomerTopUp({ userId, dsaId, paymentRef, outcome, requestId }) {
  const topUp = await CustomerWalletTopUp.findOne({ paymentRef, userId, dsaId });
  if (!topUp) throw AppError.notFound('Wallet top-up was not found');
  if (topUp.status === 'SUCCESS' || topUp.status === 'REFUNDED') {
    const wallet = await CustomerWallet.findOne({ dsaId, userId }).lean();
    return { topUp: publicTopUp(topUp, { balance: Number(wallet?.balance || 0) }), replay: true };
  }
  if (topUp.status === 'FAILED') {
    return { topUp: publicTopUp(topUp), replay: true };
  }

  const verified = verifyDemoPayment(outcome);
  await logWallet({
    stage: verified.status === 'SUCCESS' ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED',
    operation: 'WALLET_PAYMENT_VERIFY',
    requestId: requestId || topUp.requestId,
    dsaId,
    userId,
    status: verified.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
    request: { paymentRef, demo: true },
    result: { status: verified.status, provider: 'APL_MOCK_PAY' },
    errorMessage: verified.reason || undefined,
  });

  if (verified.status === 'BLOCKED' || verified.status === 'FAILED') {
    topUp.status = 'FAILED';
    topUp.failureReason = verified.reason || 'Payment was not verified';
    await topUp.save();
    return { topUp: publicTopUp(topUp), replay: false };
  }
  if (verified.status === 'PENDING') {
    return { topUp: publicTopUp(topUp), replay: false };
  }

  let claimed = topUp.status === 'CREDITING'
    ? topUp
    : await CustomerWalletTopUp.findOneAndUpdate(
      { _id: topUp._id, status: 'PENDING' },
      { $set: { status: 'CREDITING', providerRef: verified.providerRef } },
      { new: true },
    );
  if (!claimed) {
    let current = await CustomerWalletTopUp.findById(topUp._id);
    for (let attempt = 0; current && current.status === 'CREDITING' && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      current = await CustomerWalletTopUp.findById(topUp._id);
    }
    if (current && current.status === 'CREDITING') claimed = current;
    else {
      const wallet = await CustomerWallet.findOne({ dsaId, userId }).lean();
      return { topUp: publicTopUp(current, { balance: Number(wallet?.balance || 0) }), replay: true };
    }
  }

  const credited = await creditNet(claimed);
  if (claimed.status !== 'SUCCESS') {
    claimed.status = 'SUCCESS';
    claimed.providerRef = claimed.providerRef || verified.providerRef;
    claimed.failureReason = '';
    await claimed.save();
  }
  await logWallet({
    stage: 'PAYMENT_SUCCESS',
    operation: 'WALLET_CREDIT',
    requestId: requestId || claimed.requestId,
    dsaId,
    userId,
    status: 'SUCCESS',
    request: { paymentRef: claimed.paymentRef },
    result: {
      paymentRef: claimed.paymentRef,
      netCredit: claimed.netAmount,
      feeAmount: claimed.feeAmount,
      balance: credited.wallet.balance,
      replay: credited.replay,
    },
  });
  return {
    topUp: publicTopUp(claimed, { balance: credited.wallet.balance }),
    replay: credited.replay,
  };
}

async function reverseCustomerTopUp({ userId, dsaId, paymentRef, requestId }) {
  const topUp = await CustomerWalletTopUp.findOne({ paymentRef, userId, dsaId });
  if (!topUp) throw AppError.notFound('Wallet top-up was not found');
  if (topUp.status === 'REFUNDED') {
    return { topUp: publicTopUp(topUp), replay: true };
  }
  if (topUp.status !== 'SUCCESS') {
    throw AppError.validation('Only a credited top-up can be reversed');
  }
  const existing = await WalletTransaction.findOne({ reference: paymentRef, type: 'TOPUP_REVERSAL' }).lean();
  if (existing) {
    topUp.status = 'REFUNDED';
    await topUp.save();
    return { topUp: publicTopUp(topUp), replay: true };
  }
  const wallet = await CustomerWallet.findOneAndUpdate(
    { dsaId, userId, balance: { $gte: topUp.netAmount } },
    { $inc: { balance: -topUp.netAmount, totalDebits: topUp.netAmount } },
    { new: true },
  );
  if (!wallet) throw AppError.validation('Wallet balance is too low to reverse this top-up');
  try {
    await WalletTransaction.create({
      dsaId,
      userId,
      amount: topUp.netAmount,
      direction: 'DEBIT',
      type: 'TOPUP_REVERSAL',
      currency: topUp.currency || 'INR',
      reference: paymentRef,
      paymentRef,
      reason: 'Top-up reversal',
      balanceAfter: wallet.balance,
      grossAmount: topUp.grossAmount,
      feeAmount: topUp.feeAmount,
      method: topUp.method,
      status: 'REFUNDED',
    });
  } catch (error) {
    if (error && error.code === 11000) {
      await CustomerWallet.updateOne(
        { dsaId, userId },
        { $inc: { balance: topUp.netAmount, totalDebits: -topUp.netAmount } },
      );
      topUp.status = 'REFUNDED';
      await topUp.save();
      return { topUp: publicTopUp(topUp), replay: true };
    }
    throw error;
  }
  await syncUserBalance(userId, wallet.balance);
  topUp.status = 'REFUNDED';
  await topUp.save();
  await logWallet({
    stage: 'REFUND_SUCCESS',
    operation: 'WALLET_CREDIT',
    requestId,
    dsaId,
    userId,
    status: 'SUCCESS',
    request: { paymentRef },
    result: { paymentRef, reversed: topUp.netAmount, balance: wallet.balance },
  });
  return { topUp: publicTopUp(topUp, { balance: wallet.balance }), replay: false };
}

module.exports = {
  createCustomerTopUp,
  confirmCustomerTopUp,
  reverseCustomerTopUp,
  publicTopUp,
};
