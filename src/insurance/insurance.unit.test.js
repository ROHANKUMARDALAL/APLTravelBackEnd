'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { selectPlans, validateSearch, validateTravellers, DISCLAIMER } = require('./services/insurance.service');
const { redact } = require('../common/utils/redact');

const trip = {
  destination: 'United Arab Emirates',
  departureDate: '2026-12-01',
  returnDate: '2026-12-10',
  tripType: 'SINGLE',
};

describe('mock insurance catalogue', () => {
  it('returns several plans for adult travellers and keeps purchase disabled', () => {
    const plans = selectPlans({ ...trip, travellers: [{ type: 'ADULT', age: 34 }] });
    assert.ok(plans.length >= 3);
    assert.ok(plans.every((plan) => plan.mock === true));
    assert.equal(plans.some((plan) => plan.id === 'MOCK-SENIOR-CARE'), false);
    assert.ok(DISCLAIMER.includes('do not provide real coverage'));
  });

  it('keeps the senior plan only for an eligible age', () => {
    const plans = selectPlans({ ...trip, travellers: [{ type: 'ADULT', age: 68 }] });
    assert.deepEqual(plans.map((plan) => plan.id), ['MOCK-SENIOR-CARE']);
  });

  it('rejects a search without travellers', () => {
    assert.throws(() => validateSearch({ ...trip, travellers: [] }), /Invalid insurance search/);
  });

  it('requires an adult beneficiary for a minor and keeps both people', () => {
    assert.throws(() => validateTravellers({
      travellers: [{
        firstName: 'Ava', lastName: 'Child', dob: '2018-01-01', mobile: '9990001111',
        email: 'ava@example.test', address: '1 Road', nationality: 'Indian',
        beneficiary: {
          firstName: 'Young', lastName: 'Kin', relationship: 'Sibling', dob: '2016-01-01',
          mobile: '9990001112', email: 'kin@example.test', address: '1 Road',
        },
      }],
    }), (error) => {
      assert.match(error.message, /Invalid traveller details/);
      assert.match(JSON.stringify(error.details), /must be 18 or older/);
      return true;
    });
  });

  it('masks contact fields before they can be written to a log', () => {
    const hidden = redact({
      email: 'ava@example.test',
      phone: '9990001111',
      passportNumber: 'P1234567',
      beneficiary: { address: '1 Secret Road' },
    });
    assert.equal(hidden.email, '[redacted]');
    assert.equal(hidden.phone, '[redacted]');
    assert.equal(hidden.passportNumber, '[redacted]');
    assert.equal(hidden.beneficiary, '[redacted]');
  });
});
