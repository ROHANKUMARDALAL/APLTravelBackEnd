'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_phase23cab';
process.env.PUBLIC_DEV_HOST_MAP = 'phase23.localhost=APL-DSA-2323,other23.localhost=APL-DSA-2324';
process.env.PUBLIC_TENANT_BASE_DOMAIN = '';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const { createApp } = require('../app');
const { seedMasterServices } = require('../tenant/services/seed-master-services');
const Dsa = require('../tenant/models/Dsa');
const Service = require('../tenant/models/Service');
const DsaService = require('../tenant/models/DsaService');
const Supplier = require('../common/database/models/Supplier');
const SupplierService = require('../common/database/models/SupplierService');
const DsaSupplier = require('../common/database/models/DsaSupplier');
const ServiceLog = require('../common/database/models/ServiceLog');
const Search = require('../common/database/models/Search');
const User = require('../user/models/User');
const LoginSession = require('../user/models/LoginSession');
const { Booking, Payment } = require('../common/database/models/Booking');
const Refund = require('../payments/models/Refund');
const CustomerWallet = require('../customer/models/CustomerWallet');
const WalletTransaction = require('../customer/models/WalletTransaction');
const { ensureMembership } = require('../customer/services/membership.service');
const { createRule } = require('../pricing/services/pricing-rule.service');
const { RULE_KINDS } = require('../pricing/services/pricing-engine.service');

const URI = 'mongodb://127.0.0.1:27018/apl_test_phase23cab';
const HOST = 'phase23.localhost';
let server;
let token;
let dsaId;

function assertIsolated() {
  if (process.env.APL_TEST_MONGODB_URI !== URI || !URI.includes('27018') || !URI.includes('apl_test_phase23cab')) {
    throw new Error('Refusing to run outside apl_test_phase23cab');
  }
}

async function assign(ownerId, service, codes) {
  for (const [index, code] of codes.entries()) {
    const supplier = await Supplier.findOneAndUpdate(
      { code },
      { $set: { name: `${code} Mock`, status: 'ACTIVE', isMock: true, environments: ['TEST'], defaultEnvironment: 'TEST' } },
      { upsert: true, new: true },
    );
    await SupplierService.findOneAndUpdate(
      { supplierId: supplier._id, serviceId: service._id },
      { $set: { enabled: true, environment: 'TEST' } },
      { upsert: true },
    );
    await DsaSupplier.create({
      dsaId: ownerId,
      serviceId: service._id,
      supplierId: supplier._id,
      enabled: true,
      priority: index + 1,
      routingStrategy: 'PARALLEL',
    });
  }
}

function json(method, path, { body, auth, host = HOST } = {}) {
  const { port } = server.address();
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-apl-public-host': host,
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, payload: await res.json() }));
}

describe('phase 23 cab booking', () => {
  before(async () => {
    assertIsolated();
    await connectDatabase();
    await mongoose.connection.dropDatabase();
    await seedMasterServices();
    const dsa = await Dsa.create({
      dsaCode: 'APL-DSA-2323', companyName: 'Phase 23 Cab', displayName: 'Phase 23 Cab',
      ownerName: 'Owner', email: 'owner23@example.test', phone: '9990002323', subdomain: 'phase23', status: 'ACTIVE',
    });
    const other = await Dsa.create({
      dsaCode: 'APL-DSA-2324', companyName: 'Other 23', displayName: 'Other 23',
      ownerName: 'Other', email: 'other23@example.test', phone: '9990002324', subdomain: 'other23', status: 'ACTIVE',
    });
    dsaId = dsa._id;
    const transfer = await Service.findOne({ code: 'transfer' });
    assert.equal(transfer.serviceMode, 'API_BOOKING');
    await DsaService.create({ dsaId, serviceId: transfer._id, isAllowedByAPL: true, isActiveByDSA: true });
    await DsaService.create({ dsaId: other._id, serviceId: transfer._id, isAllowedByAPL: true, isActiveByDSA: true });
    await assign(dsaId, transfer, ['MOCKXFER_A', 'MOCKXFER_B']);
    await assign(other._id, transfer, ['MOCKXFER_A']);
    await createRule({
      name: 'P23 APL transfer markup', ownerScope: 'PLATFORM', ruleKind: RULE_KINDS.APL_MARKUP,
      serviceCode: 'transfer', adjustmentType: 'PERCENTAGE', value: 5, status: 'ACTIVE', priority: 100,
    }, { adminUserId: null, actorType: 'SYSTEM' });
    await createRule({
      name: 'P23 DSA transfer markup', ownerScope: 'DSA', dsaId: String(dsaId), ruleKind: RULE_KINDS.DSA_MARKUP,
      serviceCode: 'transfer', adjustmentType: 'PERCENTAGE', value: 3, status: 'ACTIVE', priority: 100,
    }, { adminUserId: null, actorType: 'SYSTEM' });
    const salt = crypto.randomBytes(16).toString('hex');
    const user = await User.create({
      name: 'Cab Tester', email: 'phase23-user@example.test', phoneNumber: '9990002325',
      passwordHash: `${salt}:${crypto.scryptSync('Test-pass-23', salt, 32).toString('hex')}`,
      currency: 'INR',
    });
    await ensureMembership({ userId: user._id, dsaId });
    token = `lgn_${crypto.randomBytes(24).toString('hex')}`;
    await LoginSession.create({
      userId: user._id,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    });
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1 && String(mongoose.connection.name) === 'apl_test_phase23cab') {
      await mongoose.connection.dropDatabase();
      await disconnectDatabase();
    }
  });

  it('books one mock cab and records the journey', async () => {
    const searched = await json('POST', '/api/v1/transfers/search', {
      body: {
        transferType: 'AIRPORT_TRANSFER',
        pickup: { name: 'Delhi Airport (DEL)', kind: 'AIRPORT', code: 'DEL' },
        dropoff: { name: 'The Leela Palace Delhi', kind: 'HOTEL' },
        pickupDateTime: '2099-11-12T10:00',
        passengers: 2,
      },
    });
    assert.equal(searched.status, 200, JSON.stringify(searched.payload));
    const data = searched.payload.data;
    assert.ok(data.transfers.length >= 2);
    assert.deepEqual(data.suppliers.map((row) => row.supplier).sort(), ['MOCKXFER_A', 'MOCKXFER_B']);
    const cab = data.transfers.find((row) => row.vehicleCategory === 'SEDAN');
    const offer = cab.primaryOffer;
    assert.equal(offer.supplier, cab.offers.find((row) => row.aplOfferId === offer.aplOfferId).supplier);
    const stored = await Search.findOne({ aplSearchId: data.searchId }).lean();
    const storedCab = stored.results.transfers.find((row) => row.aplTransferId === cab.aplTransferId);
    const storedOffer = storedCab.offers.find((row) => row.aplOfferId === offer.aplOfferId);
    assert.ok(storedOffer.price.amount > storedOffer.supplierPrice.amount);
    assert.equal(offer.price.amount, storedOffer.price.amount);
    assert.ok(Array.isArray(offer.pickupPoints) && offer.pickupPoints.length >= 1);
    const pickupPoint = offer.pickupPoints[0];

    const lookup = { searchId: data.searchId, aplTransferId: cab.aplTransferId, aplOfferId: offer.aplOfferId };
    const details = await json('POST', '/api/v1/transfers/details', { body: lookup });
    assert.equal(details.status, 200, JSON.stringify(details.payload));
    assert.equal(details.payload.data.selectedOffer.supplier, offer.supplier);
    const checked = await json('POST', '/api/v1/transfers/revalidate', { body: lookup });
    assert.equal(checked.status, 200);
    assert.equal(checked.payload.data.price.amount, offer.price.amount);

    const foreign = await json('POST', '/api/v1/transfers/details', { host: 'other23.localhost', body: lookup });
    assert.ok(foreign.status >= 400);

    const confirmPrice = { amount: offer.price.amount, currency: offer.price.currency };
    const checkout = await json('POST', '/api/v1/transfers/checkout', {
      body: {
        ...lookup,
        confirmPrice,
        contact: { email: 'cab23@example.test', phone: '9990002326', countryCode: '+91' },
        travellers: [
          { type: 'ADULT', title: 'Ms', firstName: 'Ava', lastName: 'Tester', age: 32 },
          { type: 'ADULT', title: 'Mr', firstName: 'Ravi', lastName: 'Tester', age: 34 },
        ],
        pickupPoint,
        pickupContact: 'Ava at arrivals',
      },
    });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.payload));
    const key = `pay:${checkout.payload.data.checkoutToken}`;
    const booked = await json('POST', '/api/v1/transfers/book', {
      auth: token,
      body: {
        checkoutToken: checkout.payload.data.checkoutToken,
        confirmPrice,
        payment: { method: 'UPI', upiId: 'ava@upi', idempotencyKey: key },
        idempotencyKey: key,
      },
    });
    assert.equal(booked.status, 200, JSON.stringify(booked.payload));
    const ref = booked.payload.data.aplBookingRef;
    assert.ok(ref);
    const again = await json('POST', '/api/v1/transfers/book', {
      auth: token,
      body: {
        checkoutToken: checkout.payload.data.checkoutToken,
        confirmPrice,
        payment: { method: 'UPI', upiId: 'ava@upi', idempotencyKey: key },
        idempotencyKey: key,
      },
    });
    assert.equal(again.payload.data.aplBookingRef, ref);
    assert.equal(await Booking.countDocuments({ aplBookingRef: ref, productType: 'TRANSFER', dsaId }), 1);
    const saved = await Booking.findOne({ aplBookingRef: ref }).lean();
    const snap = saved.services?.transfer || {};
    assert.equal(snap.supplier, offer.supplier);
    assert.equal(snap.pickupPoint.code, pickupPoint.code);
    assert.equal(snap.pickupContact, 'Ava at arrivals');
    assert.equal(saved.items?.[0]?.snapshot?.from, undefined);
    const charge = saved.commercialSnapshot?.paymentCharge || saved.payment || {};
    assert.equal(charge.provider, 'APL_MOCK_PAY');
    assert.equal(charge.method, 'UPI');
    assert.equal(Number(charge.feeAmount || 0), 0);

    const feed = await json('GET', '/api/v1/account/transactions', { auth: token });
    assert.equal(feed.status, 200, JSON.stringify(feed.payload));
    const tx = (feed.payload.data.transactions || []).find((row) => row.bookingReference === ref);
    assert.ok(tx);
    assert.equal(tx.direction, 'DEBIT');
    assert.equal(tx.status, 'success');
    assert.equal(tx.service, 'TRANSFER');
    assert.equal(feed.payload.data.summary.failed, 0);
    assert.ok(feed.payload.data.summary.totalPaid >= tx.amount);

    const mine = await json('GET', '/api/v1/transfers/bookings', { auth: token });
    assert.equal(mine.status, 200);
    assert.ok((mine.payload.data.bookings || mine.payload.data || []).length);

    const owner = await User.findOne({ email: 'phase23-user@example.test' });
    await CustomerWallet.create({
      dsaId, userId: owner._id, currency: 'INR', balance: 460, totalCredits: 500, totalDebits: 40,
    });
    await WalletTransaction.create({
      dsaId, userId: owner._id, amount: 500, direction: 'CREDIT', type: 'RECHARGE',
      currency: 'INR', reference: 'RCH-23', balanceAfter: 500,
    });
    await WalletTransaction.create({
      dsaId, userId: owner._id, amount: 40, direction: 'DEBIT', type: 'ADJUSTMENT',
      currency: 'INR', reference: 'ADJ-23', balanceAfter: 460,
    });
    await Payment.create({
      paymentRef: 'PAY-PEND-23', userId: owner._id, dsaId, amount: 25, currency: 'INR', status: 'PENDING', method: 'UPI',
    });
    await Payment.create({
      paymentRef: 'PAY-FAIL-23', userId: owner._id, dsaId, amount: 15, currency: 'INR', status: 'FAILED', method: 'CARD', last4: '4242',
    });
    const paid = await Payment.findOne({ bookingId: saved._id, status: 'SUCCESS' });
    await Refund.create({
      refundRef: 'RFD-23', bookingId: saved._id, paymentId: paid._id, dsaId, userId: owner._id,
      requestedAmount: 10, approvedAmount: 10, currency: 'INR', status: 'SUCCESS',
    });
    const full = await json('GET', '/api/v1/account/transactions?limit=20', { auth: token });
    const rows = full.payload.data.transactions;
    const pending = rows.find((row) => row.reference === 'PAY-PEND-23');
    const failed = rows.find((row) => row.reference === 'PAY-FAIL-23');
    const credit = rows.find((row) => row.reference === 'RCH-23');
    const debit = rows.find((row) => row.reference === 'ADJ-23');
    const refund = rows.find((row) => row.reference === 'RFD-23');
    assert.equal(pending.status, 'pending');
    assert.equal(pending.direction, null);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.direction, null);
    assert.equal(failed.method.includes('4242'), true);
    assert.equal(credit.direction, 'CREDIT');
    assert.equal(debit.direction, 'DEBIT');
    assert.equal(refund.direction, 'CREDIT');
    assert.equal(refund.status, 'refunded');
    assert.equal(full.payload.data.summary.walletBalance, 460);
    assert.equal(full.payload.data.summary.pending >= 1, true);
    assert.equal(full.payload.data.summary.failed >= 1, true);
    const onlyFailed = await json('GET', '/api/v1/account/transactions?status=failed', { auth: token });
    assert.ok(onlyFailed.payload.data.transactions.every((row) => row.status === 'failed'));
    assert.equal(onlyFailed.payload.data.transactions.some((row) => row.reference === 'PAY-FAIL-23'), true);

    const logs = await ServiceLog.find({ journeyId: data.searchId, dsaId }).lean();
    const searchMain = logs.filter((row) => row.businessOperation === 'SEARCH' && !String(row.stage).startsWith('SUPPLIER') && row.stage !== 'NORMALIZED_RESPONSE');
    assert.equal(new Set(searchMain.map((row) => row.requestId)).size, 1, searchMain.map((row) => row.stage).join(','));
    assert.equal(
      logs.filter((row) => row.businessOperation === 'SEARCH' && row.stage === 'SUPPLIER_REQUEST').length,
      2,
    );
    const ops = new Set(logs.map((row) => row.businessOperation));
    for (const name of ['SEARCH', 'DETAILS', 'RECHECK', 'CHECKOUT', 'PAYMENT', 'BOOK']) {
      assert.ok(ops.has(name), `missing ${name}: ${[...ops].join(',')}`);
    }
    assert.ok(logs.some((row) => row.stage === 'SUPPLIER_REQUEST' && row.businessOperation === 'SEARCH'));
    assert.equal(JSON.stringify(logs).includes('cab23@example.test'), false);
  });
});
