'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase24m';
process.env.PUBLIC_DEV_HOST_MAP = 'phase24m.localhost=APL-DSA-2401,other24m.localhost=APL-DSA-2402';
process.env.PUBLIC_TENANT_BASE_DOMAIN = '';
delete process.env.WALLET_TOPUP_NETBANKING_BPS;

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { connectDatabase, disconnectDatabase } = require('../common/database/connection');
const { createApp } = require('../app');
const Dsa = require('../tenant/models/Dsa');
const User = require('../user/models/User');
const LoginSession = require('../user/models/LoginSession');
const { ensureMembership } = require('../customer/services/membership.service');
const CustomerWallet = require('../customer/models/CustomerWallet');
const WalletTransaction = require('../customer/models/WalletTransaction');
const ServiceLog = require('../common/database/models/ServiceLog');
const { quotePaymentFee } = require('../payments/payment-method-fee');
const { quoteWalletTopUp } = require('./wallet-topup-fee');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase24m';
const HOST = 'phase24m.localhost';
let server;
let token;
let otherToken;
let userId;

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== URI || !URI.includes('27018') || !URI.includes('apl_test_phase24m')) {
    throw new Error('Refusing to run outside apl_test_phase24m');
  }
}

function json(method, path, { body, auth = token, host = HOST, key } = {}) {
  const { port } = server.address();
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-apl-public-host': host,
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, payload: await res.json() }));
}

async function loginFor(user) {
  const loginToken = `lgn_${crypto.randomBytes(18).toString('hex')}`;
  await LoginSession.create({
    userId: user._id,
    tokenHash: crypto.createHash('sha256').update(loginToken).digest('hex'),
    expiresAt: new Date(Date.now() + 3600000),
  });
  return loginToken;
}

describe('Phase 24M customer wallet top-up', () => {
  before(async () => {
    assertIsolated();
    await connectDatabase();
    const { mongoose } = require('../common/database/connection');
    if (mongoose.connection.name === 'apl_test_phase24m') await mongoose.connection.dropDatabase();
    const dsa = await Dsa.create({
      dsaCode: 'APL-DSA-2401', companyName: 'Phase 24M', displayName: 'Phase 24M',
      ownerName: 'Owner', email: 'owner24m@example.test', phone: '9990002401', subdomain: 'phase24m', status: 'ACTIVE',
    });
    await Dsa.create({
      dsaCode: 'APL-DSA-2402', companyName: 'Other 24M', displayName: 'Other 24M',
      ownerName: 'Other', email: 'other24m@example.test', phone: '9990002402', subdomain: 'other24m', status: 'ACTIVE',
    });
    const user = await User.create({
      name: 'Wallet Customer', email: 'wallet24m@example.test', phoneNumber: '9990002411',
      passwordHash: 'test', currency: 'INR', balance: 0,
    });
    const other = await User.create({
      name: 'Other Customer', email: 'other24m-user@example.test', phoneNumber: '9990002412',
      passwordHash: 'test', currency: 'INR', balance: 0,
    });
    userId = user._id;
    await ensureMembership({ userId: user._id, dsaId: dsa._id });
    await ensureMembership({ userId: other._id, dsaId: dsa._id });
    token = await loginFor(user);
    otherToken = await loginFor(other);
    const app = createApp();
    server = app.listen(0);
  });

  after(async () => {
    assertIsolated();
    if (server) await new Promise((resolve) => server.close(resolve));
    const { mongoose } = require('../common/database/connection');
    if (mongoose.connection.name === 'apl_test_phase24m') await mongoose.connection.dropDatabase();
    await disconnectDatabase();
  });

  it('keeps checkout card fees added on top and deducts wallet card fees', () => {
    assert.equal(quotePaymentFee(2000, 'CARD').feeAmount, 50);
    assert.equal(quotePaymentFee(2000, 'CARD').totalAmount, 2050);
    const card = quoteWalletTopUp(2000, 'CARD');
    assert.equal(card.feeMinor, 5000);
    assert.equal(card.feeAmount, 50);
    assert.equal(card.netCredit, 1950);
    const upi = quoteWalletTopUp(2000, 'UPI');
    assert.equal(upi.feeAmount, 0);
    assert.equal(upi.netCredit, 2000);
    assert.equal(quoteWalletTopUp(2000, 'NETBANKING').feeAmount, 0);
    process.env.WALLET_TOPUP_NETBANKING_BPS = '100';
    assert.equal(quoteWalletTopUp(2000, 'NETBANKING').feeAmount, 20);
    assert.equal(quoteWalletTopUp(2000, 'NETBANKING').netCredit, 1980);
    delete process.env.WALLET_TOPUP_NETBANKING_BPS;
  });

  it('credits a card top-up once and rejects a tampered net amount', async () => {
    const tamper = await json('POST', '/api/v1/account/wallet/topup', {
      key: 'tamper-1',
      body: { amount: 2000, method: 'CARD', feeAmount: 0, netAmount: 2000 },
    });
    assert.equal(tamper.status, 400);
    const created = await json('POST', '/api/v1/account/wallet/topup', {
      key: 'card-1',
      body: { amount: 2000, method: 'CARD', feeAmount: 50, netAmount: 1950 },
    });
    assert.equal(created.payload.data.netCredit, 1950);
    assert.equal(created.payload.data.status, 'PENDING');
    const pendingWallet = await json('GET', '/api/v1/account/wallet');
    assert.equal(pendingWallet.payload.data.balance, 0);

    const failed = await json('POST', `/api/v1/account/wallet/topup/${created.payload.data.paymentRef}/confirm`, {
      body: { demoOutcome: 'FAILED' },
    });
    assert.equal(failed.payload.data.status, 'FAILED');
    assert.equal((await json('GET', '/api/v1/account/wallet')).payload.data.balance, 0);

    const again = await json('POST', '/api/v1/account/wallet/topup', {
      key: 'card-2',
      body: { amount: 2000, method: 'CARD', feeAmount: 50, netAmount: 1950 },
    });
    const ref = again.payload.data.paymentRef;
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const blocked = await json('POST', `/api/v1/account/wallet/topup/${ref}/confirm`, { body: { demoOutcome: 'SUCCESS' } });
    process.env.NODE_ENV = previous;
    assert.equal(blocked.payload.data.status, 'FAILED');
    assert.equal((await json('GET', '/api/v1/account/wallet')).payload.data.balance, 0);

    const third = await json('POST', '/api/v1/account/wallet/topup', {
      key: 'card-3',
      body: { amount: 2000, method: 'CARD', feeAmount: 50, netAmount: 1950 },
    });
    const paymentRef = third.payload.data.paymentRef;
    const [first, second] = await Promise.all([
      json('POST', `/api/v1/account/wallet/topup/${paymentRef}/confirm`, { body: { demoOutcome: 'SUCCESS' } }),
      json('POST', `/api/v1/account/wallet/topup/${paymentRef}/confirm`, { body: { demoOutcome: 'SUCCESS' } }),
    ]);
    assert.equal(first.payload.data.status, 'SUCCESS');
    assert.equal(second.payload.data.status, 'SUCCESS');
    const replay = await json('POST', `/api/v1/account/wallet/topup/${paymentRef}/confirm`, { body: { demoOutcome: 'SUCCESS' } });
    assert.equal(replay.payload.data.status, 'SUCCESS');
    const wallet = await json('GET', '/api/v1/account/wallet');
    assert.equal(wallet.payload.data.balance, 1950);
    assert.equal(wallet.payload.data.totalCredits, 1950);
    assert.equal(await WalletTransaction.countDocuments({ userId, type: 'ADD_MONEY' }), 1);

    const upi = await json('POST', '/api/v1/account/wallet/topup', {
      key: 'upi-1',
      body: { amount: 2000, method: 'UPI', feeAmount: 0, netAmount: 2000 },
    });
    const upiDone = await json('POST', `/api/v1/account/wallet/topup/${upi.payload.data.paymentRef}/confirm`, {
      body: { demoOutcome: 'SUCCESS' },
    });
    assert.equal(upiDone.payload.data.netCredit, 2000);
    assert.equal((await json('GET', '/api/v1/account/wallet')).payload.data.balance, 3950);

    const foreign = await json('POST', `/api/v1/account/wallet/topup/${paymentRef}/confirm`, { auth: otherToken, body: { demoOutcome: 'SUCCESS' } });
    assert.equal(foreign.status, 404);
    const otherSite = await json('GET', '/api/v1/account/wallet', { host: 'other24m.localhost' });
    assert.equal(otherSite.status, 403);

    const debited = await CustomerWallet.findOneAndUpdate(
      { userId, balance: { $gte: 100 } },
      { $inc: { balance: -100, totalDebits: 100 } },
      { new: true },
    );
    assert.equal(debited.balance, 3850);

    const reversed = await json('POST', `/api/v1/account/wallet/topup/${upi.payload.data.paymentRef}/reverse`);
    assert.equal(reversed.payload.data.status, 'REFUNDED');
    const twice = await json('POST', `/api/v1/account/wallet/topup/${upi.payload.data.paymentRef}/reverse`);
    assert.equal(twice.payload.data.status, 'REFUNDED');
    assert.equal((await json('GET', '/api/v1/account/wallet')).payload.data.balance, 1850);

    const history = await json('GET', '/api/v1/account/transactions?service=WALLET');
    const types = history.payload.data.transactions.map((row) => row.type);
    assert.ok(types.includes('Add Money'));
    assert.ok(types.includes('Top-up reversal'));
    const logs = await ServiceLog.find({ service: 'WALLET', userId }).lean();
    const operations = new Set(logs.map((row) => row.operation));
    assert.ok(operations.has('WALLET_ADD_MONEY'));
    assert.ok(operations.has('WALLET_PAYMENT_VERIFY'));
    assert.ok(operations.has('WALLET_CREDIT'));
    assert.equal(logs.some((row) => JSON.stringify(row.request || {}).includes('wallet24m@')), false);
  });
});
