'use strict';

const mongoose = require('mongoose');
const { AppError } = require('../common/errors/app-error');

/**
 * DSA agency wallet. Separate from CustomerWallet.
 * Amounts are integer minor units (paise). Ledger rows are append-only.
 * A top-up request does not credit the wallet.
 */

const walletSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    currency: { type: String, default: 'INR' },
    balanceMinor: { type: Number, required: true, default: 0 },
    totalCreditsMinor: { type: Number, required: true, default: 0 },
    totalDebitsMinor: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: 'dsaagencywallets' },
);

const ledgerSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, required: true },
    direction: { type: String, required: true, enum: ['CREDIT', 'DEBIT'] },
    amountMinor: { type: Number, required: true },
    balanceAfterMinor: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, default: 'POSTED' },
    idempotencyKey: { type: String, required: true, unique: true },
    bookingRef: { type: String, default: '' },
    paymentRef: { type: String, default: '' },
    topUpId: { type: mongoose.Schema.Types.ObjectId, default: null },
    reason: { type: String, default: '' },
    actorId: { type: String, default: '' },
    actorEmail: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'dsaagencyledgers' },
);

const topUpSchema = new mongoose.Schema(
  {
    dsaId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    amountMinor: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    paymentRef: { type: String, default: '' },
    note: { type: String, default: '' },
    status: { type: String, default: 'PENDING', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
    requestedBy: { type: String, default: '' },
    reviewedBy: { type: String, default: '' },
    reviewNote: { type: String, default: '' },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'dsawallettopups' },
);

const Wallet = mongoose.models.DsaAgencyWallet || mongoose.model('DsaAgencyWallet', walletSchema);
const Ledger = mongoose.models.DsaAgencyLedger || mongoose.model('DsaAgencyLedger', ledgerSchema);
const TopUp = mongoose.models.DsaWalletTopUp || mongoose.model('DsaWalletTopUp', topUpSchema);

function toMinor(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw AppError.validation('Amount must be greater than zero');
  }
  const minor = Math.round(n * 100);
  if (!Number.isInteger(minor) || minor <= 0) {
    throw AppError.validation('Amount must be a valid currency value');
  }
  return minor;
}

function publicWallet(doc) {
  const balance = doc?.balanceMinor || 0;
  const credits = doc?.totalCreditsMinor || 0;
  const debits = doc?.totalDebitsMinor || 0;
  return {
    currency: doc?.currency || 'INR',
    balanceMinor: balance,
    totalCreditsMinor: credits,
    totalDebitsMinor: debits,
    availableBalance: balance / 100,
    totalCredits: credits / 100,
    totalDebits: debits / 100,
  };
}

function publicEntry(row) {
  return {
    id: String(row._id),
    type: row.type,
    direction: row.direction,
    status: row.status,
    amountMinor: row.amountMinor,
    amount: row.amountMinor / 100,
    balanceAfter: row.balanceAfterMinor / 100,
    currency: row.currency,
    bookingRef: row.bookingRef || '',
    paymentRef: row.paymentRef || '',
    reason: row.reason || '',
    actorEmail: row.actorEmail || '',
    createdAt: row.createdAt,
  };
}

async function ensureWallet(dsaId) {
  await Wallet.updateOne(
    { dsaId },
    { $setOnInsert: { dsaId, currency: 'INR', balanceMinor: 0, totalCreditsMinor: 0, totalDebitsMinor: 0 } },
    { upsert: true },
  );
  return Wallet.findOne({ dsaId });
}

async function postEntry({
  dsaId,
  direction,
  type,
  amountMinor,
  idempotencyKey,
  reason = '',
  bookingRef = '',
  paymentRef = '',
  topUpId = null,
  actor = {},
}) {
  if (!idempotencyKey) throw AppError.validation('idempotencyKey is required');
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw AppError.validation('amountMinor must be a positive integer');
  }
  const existing = await Ledger.findOne({ idempotencyKey }).lean();
  if (existing) {
    const wallet = await ensureWallet(dsaId);
    return { replay: true, wallet: publicWallet(wallet), entry: publicEntry(existing) };
  }
  await ensureWallet(dsaId);
  const inc = direction === 'CREDIT'
    ? { balanceMinor: amountMinor, totalCreditsMinor: amountMinor }
    : { balanceMinor: -amountMinor, totalDebitsMinor: amountMinor };
  const filter = { dsaId };
  if (direction === 'DEBIT') filter.balanceMinor = { $gte: amountMinor };
  const updated = await Wallet.findOneAndUpdate(filter, { $inc: inc }, { new: true });
  if (!updated) {
    const err = AppError.validation('Insufficient DSA wallet balance');
    err.code = 'INSUFFICIENT_WALLET';
    throw err;
  }
  try {
    const entry = await Ledger.create({
      dsaId,
      type,
      direction,
      amountMinor,
      balanceAfterMinor: updated.balanceMinor,
      currency: updated.currency || 'INR',
      idempotencyKey,
      bookingRef,
      paymentRef,
      topUpId,
      reason: String(reason || '').slice(0, 500),
      actorId: actor.id || '',
      actorEmail: actor.email || '',
    });
    return { replay: false, wallet: publicWallet(updated), entry: publicEntry(entry) };
  } catch (error) {
    if (error && error.code === 11000) {
      await Wallet.updateOne(
        { dsaId },
        {
          $inc: {
            balanceMinor: -inc.balanceMinor,
            totalCreditsMinor: -(inc.totalCreditsMinor || 0),
            totalDebitsMinor: -(inc.totalDebitsMinor || 0),
          },
        },
      );
      const entry = await Ledger.findOne({ idempotencyKey }).lean();
      const wallet = await Wallet.findOne({ dsaId });
      return { replay: true, wallet: publicWallet(wallet), entry: publicEntry(entry) };
    }
    throw error;
  }
}

async function getSummary(dsaId) {
  const wallet = await Wallet.findOne({ dsaId });
  return publicWallet(wallet);
}

async function listTransactions(dsaId, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
  const filter = { dsaId };
  if (query.type) filter.type = String(query.type);
  if (query.status) filter.status = String(query.status);
  if (query.reference) {
    const ref = String(query.reference).trim();
    filter.$or = [{ bookingRef: ref }, { paymentRef: ref }];
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }
  const [total, rows] = await Promise.all([
    Ledger.countDocuments(filter),
    Ledger.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return { page, limit, total, items: rows.map(publicEntry) };
}

async function requestTopUp({ dsaId, amount, paymentRef = '', note = '', actor = {} }) {
  const amountMinor = toMinor(amount);
  const doc = await TopUp.create({
    dsaId,
    amountMinor,
    paymentRef: String(paymentRef || '').slice(0, 80),
    note: String(note || '').slice(0, 300),
    status: 'PENDING',
    requestedBy: actor.email || actor.id || '',
  });
  return {
    id: String(doc._id),
    status: doc.status,
    amount: doc.amountMinor / 100,
    paymentRef: doc.paymentRef,
    createdAt: doc.createdAt,
  };
}

async function listTopUps(filter, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
  const mongo = { ...filter };
  if (query.status) mongo.status = String(query.status);
  const [total, rows] = await Promise.all([
    TopUp.countDocuments(mongo),
    TopUp.find(mongo).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return {
    page,
    limit,
    total,
    items: rows.map((row) => ({
      id: String(row._id),
      dsaId: String(row.dsaId),
      status: row.status,
      amount: row.amountMinor / 100,
      amountMinor: row.amountMinor,
      paymentRef: row.paymentRef,
      note: row.note,
      requestedBy: row.requestedBy,
      reviewedBy: row.reviewedBy,
      reviewNote: row.reviewNote,
      createdAt: row.createdAt,
    })),
  };
}

async function approveTopUp({ id, actor, note = '' }) {
  const current = await TopUp.findById(id);
  if (!current) throw AppError.notFound('Top-up request not found');
  if (current.status === 'APPROVED') {
    const entry = await Ledger.findOne({ idempotencyKey: `topup:${current._id}` }).lean();
    const wallet = await ensureWallet(current.dsaId);
    return { replay: true, wallet: publicWallet(wallet), entry: entry ? publicEntry(entry) : null, request: current };
  }
  if (current.status !== 'PENDING') throw AppError.validation('Only a pending top-up can be approved');
  const claimed = await TopUp.findOneAndUpdate(
    { _id: current._id, status: 'PENDING' },
    { $set: { status: 'APPROVED', reviewedBy: actor.email || '', reviewNote: String(note || '').slice(0, 300), reviewedAt: new Date() } },
    { new: true },
  );
  if (!claimed) return approveTopUp({ id, actor, note });
  const posted = await postEntry({
    dsaId: claimed.dsaId,
    direction: 'CREDIT',
    type: 'TOPUP',
    amountMinor: claimed.amountMinor,
    idempotencyKey: `topup:${claimed._id}`,
    paymentRef: claimed.paymentRef,
    topUpId: claimed._id,
    reason: note || 'Top-up approved',
    actor,
  });
  return { ...posted, request: claimed };
}

async function rejectTopUp({ id, actor, note = '' }) {
  if (!String(note || '').trim()) throw AppError.validation('A rejection reason is required');
  const claimed = await TopUp.findOneAndUpdate(
    { _id: id, status: 'PENDING' },
    { $set: { status: 'REJECTED', reviewedBy: actor.email || '', reviewNote: String(note).slice(0, 300), reviewedAt: new Date() } },
    { new: true },
  );
  if (!claimed) {
    const current = await TopUp.findById(id);
    if (!current) throw AppError.notFound('Top-up request not found');
    throw AppError.validation('Only a pending top-up can be rejected');
  }
  return { id: String(claimed._id), status: claimed.status };
}

async function manualAdjust({ dsaId, direction, amount, reason, idempotencyKey, actor }) {
  if (!String(reason || '').trim()) throw AppError.validation('A reason is required');
  if (direction !== 'CREDIT' && direction !== 'DEBIT') throw AppError.validation('direction must be CREDIT or DEBIT');
  return postEntry({
    dsaId,
    direction,
    type: 'ADJUSTMENT',
    amountMinor: toMinor(amount),
    idempotencyKey: idempotencyKey || `adjust:${dsaId}:${direction}:${Date.now()}:${Math.random()}`,
    reason,
    actor,
  });
}

async function settleBookingDebit({ dsaId, aplBookingRef, amountMajor, actor = {} }) {
  if (!dsaId || !aplBookingRef) return { skipped: true };
  const amountMinor = Math.round(Number(amountMajor) * 100);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { skipped: true };
  try {
    return await postEntry({
      dsaId,
      direction: 'DEBIT',
      type: 'BOOKING',
      amountMinor,
      idempotencyKey: `booking:${aplBookingRef}`,
      bookingRef: aplBookingRef,
      reason: `Booking ${aplBookingRef}`,
      actor,
    });
  } catch (error) {
    if (error.code === 'INSUFFICIENT_WALLET') return { skipped: true, reason: 'INSUFFICIENT_WALLET' };
    throw error;
  }
}

async function reconcile(dsaId) {
  const wallet = await ensureWallet(dsaId);
  const rows = await Ledger.aggregate([
    { $match: { dsaId: wallet.dsaId } },
    {
      $group: {
        _id: '$direction',
        total: { $sum: '$amountMinor' },
      },
    },
  ]);
  const credit = rows.find((row) => row._id === 'CREDIT')?.total || 0;
  const debit = rows.find((row) => row._id === 'DEBIT')?.total || 0;
  const expected = credit - debit;
  return {
    matches: expected === wallet.balanceMinor && credit === wallet.totalCreditsMinor && debit === wallet.totalDebitsMinor,
    expectedBalanceMinor: expected,
    balanceMinor: wallet.balanceMinor,
  };
}

module.exports = {
  Wallet,
  Ledger,
  TopUp,
  getSummary,
  listTransactions,
  requestTopUp,
  listTopUps,
  approveTopUp,
  rejectTopUp,
  manualAdjust,
  settleBookingDebit,
  reconcile,
  postEntry,
};
