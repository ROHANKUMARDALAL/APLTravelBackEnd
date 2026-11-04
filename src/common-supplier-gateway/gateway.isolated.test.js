'use strict';

process.env.NODE_ENV = 'test';
process.env.APL_ALLOW_TEST_DB = '1';
process.env.APL_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27018/apl_test_gateway_csg';
process.env.GATEWAY_CREDENTIAL_KEY = 'gateway-test-key';
process.env.SUPPLIER_TBO_TEST_BASE_URL = 'https://apl-tbo.example.test';
process.env.SUPPLIER_TBO_TEST_API_KEY = 'apl-owned-secret';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { connectDatabase, disconnectDatabase, mongoose } = require('../common/database/connection');
const { encryptJson } = require('./crypto');
const SupplierCredential = require('./models/SupplierCredential');
const { resolveAssignmentCredentials } = require('./credentials');
const { executeSupplierSearch } = require('./execute');
const { selectLowestFlights, selectLowestHotels } = require('./aggregate');
const { storeDisplayedOffers, assertOfferOwnership, claimOffer, confirmFare } = require('./offers');
const { createPlaceholderAdapter } = require('./placeholder');
const { credentialSource } = require('./credentials');
const { gatewayDiagnostic, rotateCredential } = require('./diagnostics');
const { executeSupplierPlan } = require('../suppliers/services/supplier-execution.service');

const flight = (supplier, amount, extra = {}) => ({
  supplierCode: supplier,
  supplierOfferRef: `${supplier}-${amount}`,
  currency: 'INR',
  customerPayable: amount,
  priceComplete: true,
  cabin: 'ECONOMY',
  fareBrand: 'SAVER',
  refundable: false,
  baggage: { cabinKg: 7, checkinKg: 15 },
  passengers: '1-0-0',
  segments: [{
    airline: 'AI',
    flightNumber: 'AI101',
    origin: 'DEL',
    destination: 'BOM',
    departureAt: '2026-12-01T10:00:00',
    arrivalAt: '2026-12-01T12:00:00',
  }],
  ...extra,
});

describe('common supplier gateway', () => {
  before(async () => {
    await connectDatabase();
    await mongoose.connection.dropDatabase();
  });

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await disconnectDatabase();
    }
  });

  it('keeps the lowest comparable flight and all alternatives', () => {
    const result = selectLowestFlights([
      flight('TBO', 5100),
      flight('TRIPJACK', 4700),
      flight('KAFILA', 4900),
    ]);
    assert.equal(result.displayed.length, 1);
    assert.equal(result.displayed[0].supplierCode, 'TRIPJACK');
    assert.equal(result.displayed[0].customerPayable, 4700);
    assert.equal(result.displayed[0].alternatives.length, 2);
  });

  it('does not merge different baggage or refund conditions', () => {
    const result = selectLowestFlights([
      flight('TBO', 5100),
      flight('TRIPJACK', 4700, { baggage: { cabinKg: 7, checkinKg: 25 }, refundable: true, fareBrand: 'FLEXI' }),
    ]);
    assert.equal(result.displayed.length, 2);
  });

  it('does not treat similar hotel names as the same property', () => {
    const result = selectLowestHotels([
      { supplierCode: 'TBO', propertyId: 'H1', roomCategory: 'DELUXE', mealPlan: 'Breakfast', refundable: true, currency: 'INR', customerPayable: 8000, priceComplete: true },
      { supplierCode: 'OTHER', propertyName: 'Harbor Hotel', roomCategory: 'DELUXE', mealPlan: 'Breakfast', refundable: true, currency: 'INR', customerPayable: 1000, priceComplete: true },
    ]);
    assert.equal(result.displayed.length, 1);
    assert.equal(result.preserved.length, 1);
    assert.equal(result.displayed[0].propertyId, 'H1');
  });

  it('returns the successful supplier when another times out and skips disabled suppliers', async () => {
    let disabledCalls = 0;
    const result = await executeSupplierSearch({
      timeoutMs: 40,
      entries: [
        { supplierCode: 'SLOW', enabled: true, adapter: {}, rateLimitPerMinute: 10 },
        { supplierCode: 'FAST', enabled: true, adapter: {}, rateLimitPerMinute: 10 },
        { supplierCode: 'OFF', enabled: false, adapter: {}, rateLimitPerMinute: 10 },
      ],
      invoke: async (entry) => {
        if (entry.supplierCode === 'OFF') disabledCalls += 1;
        if (entry.supplierCode === 'SLOW') return new Promise(() => {});
        return [flight('FAST', 4200)];
      },
    });
    assert.equal(disabledCalls, 0);
    assert.equal(result.called.includes('OFF'), false);
    assert.equal(result.offers[0].supplierCode, 'FAST');
    assert.equal(result.diagnostics.some((row) => row.supplierCode === 'SLOW' && row.status === 'FAILED'), true);
  });

  it('labels an unknown supplier as pending instead of inventing an API', () => {
    const adapter = createPlaceholderAdapter('NEWCO');
    assert.equal(adapter.integrationStatus, 'PLACEHOLDER');
    assert.ok(adapter.missing.includes('official API documentation'));
  });

  it('isolates client credentials and binds booking to the selected supplier', async () => {
    const dsaA = new Types.ObjectId();
    const dsaB = new Types.ObjectId();
    const supplierId = new Types.ObjectId();
    const sealed = encryptJson({ baseUrl: 'https://client-b.example.test', apiKey: 'client-b-secret' }, process.env.GATEWAY_CREDENTIAL_KEY);
    const clientDoc = await SupplierCredential.create({
      dsaId: dsaB,
      supplierId,
      environment: 'TEST',
      ownership: 'CLIENT',
      ...sealed,
    });
    const clientResolved = await resolveAssignmentCredentials({
      dsaId: dsaB,
      supplierId,
      credentialConfigId: clientDoc._id,
      ownershipMode: 'CLIENT',
      credentialOwner: 'CLIENT',
      environment: 'TEST',
      supplierCode: 'TBO',
      isMock: true,
    });
    assert.equal(clientResolved.secrets.apiKey, 'client-b-secret');
    const crossed = await resolveAssignmentCredentials({
      dsaId: dsaA,
      supplierId,
      credentialConfigId: clientDoc._id,
      ownershipMode: 'CLIENT',
      credentialOwner: 'CLIENT',
      environment: 'TEST',
      supplierCode: 'TBO',
      isMock: true,
    });
    assert.equal(crossed.configured, false);
    assert.equal(crossed.secrets, null);
    const aplResolved = await resolveAssignmentCredentials({
      credentialOwner: 'APL',
      credentialRef: 'SUPPLIER_TBO',
      environment: 'TEST',
      supplierCode: 'TBO',
      isMock: true,
    });
    assert.equal(aplResolved.secrets.apiKey, 'apl-owned-secret');
    assert.notEqual(aplResolved.secrets.apiKey, 'client-b-secret');

    const [stored] = await storeDisplayedOffers({
      dsaId: dsaB,
      searchId: 'search-b',
      serviceCode: 'flight',
      offers: [{ ...flight('TBO', 4700), fareId: 'fare-b', supplierId: String(supplierId), credentialConfigId: String(clientDoc._id), credentialOwner: 'CLIENT' }],
    });
    const owned = await assertOfferOwnership({
      dsaId: dsaB,
      searchId: 'search-b',
      fareId: 'fare-b',
      supplierCode: 'TBO',
    });
    assert.equal(owned.offerRef, stored.offerRef);
    assert.equal(owned.credentialConfigId, String(clientDoc._id));
    await assert.rejects(
      () => assertOfferOwnership({ dsaId: dsaB, searchId: 'search-b', fareId: 'fare-b', supplierCode: 'TRIPJACK' }),
      /different supplier/,
    );
    const first = await claimOffer({ dsaId: dsaB, offerRef: stored.offerRef, idempotencyKey: 'pay-1' });
    const second = await claimOffer({ dsaId: dsaB, offerRef: stored.offerRef, idempotencyKey: 'pay-1' });
    assert.equal(first.replay, false);
    assert.equal(second.replay, true);
    assert.equal(second.offerRef, first.offerRef);
    const otherTenant = await SupplierCredential.find({ dsaId: dsaA }).lean();
    assert.equal(otherTenant.length, 0);
  });

  it('enforces hybrid ownership without credential fallback', () => {
    assert.equal(credentialSource({ ownershipMode: 'HYBRID', credentialOwner: 'CLIENT' }).owner, 'CLIENT');
    assert.equal(credentialSource({ ownershipMode: 'HYBRID', credentialOwner: 'APL' }).owner, 'APL');
    assert.equal(credentialSource({ ownershipMode: 'CLIENT', credentialOwner: 'APL' }).allowed, false);
    assert.equal(credentialSource({ ownershipMode: 'APL', credentialOwner: 'CLIENT' }).allowed, false);
    assert.deepEqual(confirmFare({ lockedAmount: 4700, quotedAmount: 4900, accepted: false }).status, 'PRICE_CHANGED');
    assert.equal(confirmFare({ lockedAmount: 4900, quotedAmount: 4900, accepted: true }).status, 'CONFIRMED');
  });

  it('does not compare an incomplete price with a complete price', () => {
    const result = selectLowestFlights([
      flight('TBO', 1000, { priceComplete: false }),
      flight('TRIPJACK', 4700),
    ]);
    assert.equal(result.displayed.length, 1);
    assert.equal(result.displayed[0].supplierCode, 'TRIPJACK');
    assert.equal(result.preserved.length, 1);
  });

  it('follows priority and fallback routing', async () => {
    const entries = [
      { supplierCode: 'FIRST', adapter: { code: 'FIRST' } },
      { supplierCode: 'SECOND', adapter: { code: 'SECOND' } },
    ];
    const called = [];
    const priority = await executeSupplierPlan({
      strategy: 'PRIORITY',
      suppliers: entries,
    }, {
      timeoutMs: 200,
      invoke: async (entry) => {
        called.push(entry.supplierCode);
        if (entry.supplierCode === 'FIRST') return { status: 'FAILED', errorCode: 'DOWN' };
        return { status: 'SUCCESS', flights: [{ id: 1 }] };
      },
      isUsable: (outcome) => outcome.status === 'SUCCESS' && outcome.flights?.length > 0,
    });
    assert.deepEqual(called, ['FIRST', 'SECOND']);
    assert.equal(priority.skipped.length, 0);
    const fallbackCalled = [];
    const fallback = await executeSupplierPlan({
      strategy: 'FALLBACK',
      suppliers: entries,
    }, {
      timeoutMs: 200,
      invoke: async (entry) => {
        fallbackCalled.push(entry.supplierCode);
        return { status: 'SUCCESS', flights: [] };
      },
      isUsable: (outcome) => outcome.flights?.length > 0,
    });
    assert.deepEqual(fallbackCalled, ['FIRST']);
    assert.equal(fallback.skipped[0].supplierCode, 'SECOND');
  });

  it('redacts secrets and rotates ciphertext', () => {
    const view = gatewayDiagnostic({
      requestId: 'req-27k',
      supplierCode: 'TBO',
      payload: { apiKey: 'client-b-secret', requestId: 'req-27k' },
    });
    assert.equal(view.requestId, 'req-27k');
    assert.equal(view.payload.apiKey, '[redacted]');
    assert.equal(JSON.stringify(view).includes('client-b-secret'), false);
    const sealed = encryptJson({ apiKey: 'rotate-me' }, 'old-key');
    const rotated = rotateCredential(sealed, 'old-key', 'new-key');
    const { decryptJson } = require('./crypto');
    assert.equal(decryptJson(rotated, 'new-key').apiKey, 'rotate-me');
  });
});
