'use strict';

const crypto = require('crypto');
const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');

/**
 * Mock insurance adapter. A live insurer replaces issueDemo without changing
 * the customer pages. It never issues a real policy.
 */
const mockInsuranceAdapter = {
  code: 'MOCK_INSURE',
  isMock: true,

  async issueDemo(snapshot = {}, context = {}) {
    const reference = `DEMO-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const request = {
      environment: 'TEST',
      mock: true,
      planId: snapshot.planId || null,
      destination: snapshot.destination || null,
      departureDate: snapshot.departureDate || null,
      returnDate: snapshot.returnDate || null,
      travellerCount: snapshot.travellerCount || 0,
    };
    const response = {
      mock: true,
      supplier: 'MOCK_INSURE',
      status: 'DEMO_CONFIRMED',
      reference,
      policyIssued: false,
      disclaimer: 'DEMO / MOCK. This reference is not an insurance policy or certificate.',
    };
    const base = {
      requestId: context.requestId,
      journeyId: context.journeyId || context.searchId,
      searchId: context.searchId,
      businessOperation: 'BOOK',
      dsaId: context.dsaId,
      userId: context.userId,
      service: 'INSURANCE',
      operation: 'issueDemo',
      supplierCode: 'MOCK_INSURE',
      status: 'SUCCESS',
    };
    await writeLifecycleLog({
      ...base,
      stage: 'SUPPLIER_REQUEST',
      direction: 'SUPPLIER',
      storeRaw: true,
      rawPayload: request,
      supplierRequest: request,
    });
    await writeLifecycleLog({
      ...base,
      stage: 'SUPPLIER_RESPONSE',
      direction: 'SUPPLIER',
      storeRaw: true,
      rawPayload: response,
      result: response,
    });
    return response;
  },
};

module.exports = { mockInsuranceAdapter };
