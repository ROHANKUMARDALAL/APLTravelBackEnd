'use strict';

const { AppError, ErrorCode } = require('../common/errors/app-error');
const CustomerWallet = require('../customer/models/CustomerWallet');
const WalletTransaction = require('../customer/models/WalletTransaction');
const User = require('../user/models/User');
const { normalizeServiceCode } = require('./booking-payment-label');

function minor(amount) {
  return Math.round(Number(amount) * 100);
}

function insufficientWalletError({ balance, requiredAmount, currency }) {
  const shortfall = Math.max(0, (minor(requiredAmount) - minor(balance)) / 100);
  return new AppError(
    ErrorCode.INSUFFICIENT_WALLET_BALANCE,
    'Your booking amount exceeds your available wallet balance.',
    {
      httpStatus: 400,
      details: [{
        code: 'INSUFFICIENT_WALLET_BALANCE',
        balance: Number(balance || 0),
        requiredAmount: Number(requiredAmount),
        shortfall,
        currency: currency || 'INR',
      }],
    },
  );
}

async function postedBalance({ userId, dsaId, currency }) {
  const wallet = await CustomerWallet.findOne({ userId, dsaId, currency }).lean();
  return { wallet, balance: Number(wallet?.balance || 0) };
}

async function assertWalletCoversBooking({ userId, dsaId, currency, amount }) {
  const { balance } = await postedBalance({ userId, dsaId, currency });
  if (minor(balance) < minor(amount)) {
    throw insufficientWalletError({ balance, requiredAmount: amount, currency });
  }
  return balance;
}

async function debitCustomerWalletForBooking({
  userId,
  dsaId,
  currency,
  amount,
  paymentRef,
  bookingReference = '',
  serviceCode = '',
}) {
  if (!paymentRef) throw AppError.validation('Wallet payment reference is required');
  const existing = await WalletTransaction.findOne({ reference: paymentRef, type: 'BOOKING_DEBIT' }).lean();
  if (existing) {
    const wallet = await CustomerWallet.findOne({ userId, dsaId }).lean();
    return { replay: true, balance: Number(wallet?.balance || 0) };
  }
  await assertWalletCoversBooking({ userId, dsaId, currency, amount });
  const updated = await CustomerWallet.findOneAndUpdate(
    { userId, dsaId, currency, balance: { $gte: amount } },
    { $inc: { balance: -amount, totalDebits: amount } },
    { new: true },
  );
  if (!updated) {
    const { balance } = await postedBalance({ userId, dsaId, currency });
    throw insufficientWalletError({ balance, requiredAmount: amount, currency });
  }
  try {
    await WalletTransaction.create({
      dsaId,
      userId,
      amount,
      direction: 'DEBIT',
      type: 'BOOKING_DEBIT',
      currency,
      reference: paymentRef,
      paymentRef,
      bookingReference,
      serviceCode: normalizeServiceCode(serviceCode),
      reason: 'Booking payment',
      balanceAfter: updated.balance,
      method: 'WALLET',
      status: 'SUCCESS',
    });
  } catch (error) {
    if (error && error.code === 11000) {
      await CustomerWallet.updateOne(
        { userId, dsaId },
        { $inc: { balance: amount, totalDebits: -amount } },
      );
      const wallet = await CustomerWallet.findOne({ userId, dsaId }).lean();
      return { replay: true, balance: Number(wallet?.balance || 0) };
    }
    throw error;
  }
  await User.updateOne({ _id: userId }, { $set: { balance: updated.balance } });
  return { replay: false, balance: updated.balance };
}

async function reverseCustomerWalletDebit({ userId, dsaId, currency, amount, paymentRef, serviceCode = '' }) {
  const reference = `${paymentRef}:reversal`;
  const existing = await WalletTransaction.findOne({ reference, type: 'BOOKING_REVERSAL' }).lean();
  if (existing) return { replay: true };
  const debit = await WalletTransaction.findOne({ paymentRef, type: 'BOOKING_DEBIT' }).select('serviceCode bookingReference').lean();
  const updated = await CustomerWallet.findOneAndUpdate(
    { userId, dsaId },
    { $inc: { balance: amount, totalCredits: amount } },
    { upsert: true, new: true },
  );
  try {
    await WalletTransaction.create({
      dsaId,
      userId,
      amount,
      direction: 'CREDIT',
      type: 'BOOKING_REVERSAL',
      currency: currency || updated.currency || 'INR',
      reference,
      paymentRef,
      bookingReference: debit?.bookingReference || '',
      serviceCode: normalizeServiceCode(serviceCode || debit?.serviceCode),
      reason: 'Booking payment reversal',
      balanceAfter: updated.balance,
      method: 'WALLET',
      status: 'REFUNDED',
    });
  } catch (error) {
    if (error && error.code === 11000) {
      await CustomerWallet.updateOne(
        { userId, dsaId },
        { $inc: { balance: -amount, totalCredits: -amount } },
      );
      return { replay: true };
    }
    throw error;
  }
  await User.updateOne({ _id: userId }, { $set: { balance: updated.balance } });
  return { replay: false, balance: updated.balance };
}

module.exports = {
  minor,
  insufficientWalletError,
  assertWalletCoversBooking,
  debitCustomerWalletForBooking,
  reverseCustomerWalletDebit,
};
