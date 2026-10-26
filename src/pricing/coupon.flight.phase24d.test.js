'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calculatePrice, RULE_KINDS } = require('./services/pricing-engine.service');
const {
  findFlightFare,
  quoteFlightFamilyCoupon,
} = require('./services/coupon.service');

function rule(partial) {
  return {
    _id: partial._id,
    name: partial.name || partial._id,
    status: 'ACTIVE',
    priority: 100,
    ownerScope: partial.ownerScope || 'PLATFORM',
    dsaId: partial.dsaId || null,
    serviceCode: 'flight',
    supplierCode: null,
    tripType: null,
    effectiveFrom: null,
    effectiveTo: null,
    ...partial,
  };
}

function pricedFrom(supplierAmount, rules) {
  return calculatePrice({
    supplierPrice: { amount: supplierAmount, currency: 'INR' },
    supplierCode: 'TBO',
    context: {
      rules,
      dsaId: 'dsa1',
      serviceCode: 'flight',
      at: new Date('2026-10-26T00:00:00Z'),
      pricingVersion: '12.0',
    },
    includeInternal: true,
  });
}

const markupRules = [
  rule({ _id: 'apl', ruleKind: RULE_KINDS.APL_MARKUP, adjustmentType: 'PERCENTAGE', value: 2 }),
  rule({
    _id: 'ceil',
    ruleKind: RULE_KINDS.DSA_MARKUP_CEILING,
    adjustmentType: 'PERCENTAGE',
    value: 8,
  }),
  rule({
    _id: 'dsa-pct',
    ruleKind: RULE_KINDS.DSA_MARKUP,
    ownerScope: 'DSA',
    dsaId: 'dsa1',
    adjustmentType: 'PERCENTAGE',
    value: 4,
  }),
];

describe('Phase 24D flight coupon on the selected family total', () => {
  it('Publish 8366 minus a valid 100 coupon is 8266', () => {
    const priced = pricedFrom(3500, markupRules);
    const quote = quoteFlightFamilyCoupon({
      fare: { fareType: 'PUBLISH', price: { amount: 4183, currency: 'INR' } },
      priced,
      coupon: { code: 'TEST100', adjustmentType: 'FIXED', value: 100, currency: 'INR' },
      passengers: 2,
    });
    assert.equal(quote.fare, 8366);
    assert.equal(quote.couponSavings, 100);
    assert.equal(quote.total, 8266);
    assert.equal(quote.couponStatus, 'APPLIED');
  });

  it('prices Saver, Publish, Flexi and Corporate from their own totals', () => {
    const priced = pricedFrom(3500, markupRules);
    const families = [
      ['SAVER', 3873, 2, 7746],
      ['PUBLISH', 4183, 2, 8366],
      ['FLEXI', 4570, 2, 9140],
      ['CORPORATE', 4880, 2, 9760],
    ];
    const totals = families.map(([fareType, unit, passengers, gross]) => {
      const quote = quoteFlightFamilyCoupon({
        fare: { fareType, price: { amount: unit, currency: 'INR' } },
        priced,
        coupon: { adjustmentType: 'FIXED', value: 100, currency: 'INR' },
        passengers,
      });
      assert.equal(quote.fare, gross);
      assert.equal(quote.couponSavings, 100);
      assert.equal(quote.total, gross - 100);
      return quote.total;
    });
    assert.equal(new Set(totals).size, 4);
  });

  it('applies a fixed coupon once for several passengers and caps a percentage', () => {
    const priced = pricedFrom(3500, markupRules);
    const fixed = quoteFlightFamilyCoupon({
      fare: { fareType: 'PUBLISH', price: { amount: 4183 } },
      priced,
      coupon: { adjustmentType: 'FIXED', value: 100, currency: 'INR' },
      passengers: 3,
    });
    assert.equal(fixed.couponSavings, 100);
    assert.equal(fixed.total, 4183 * 3 - 100);
    const percent = quoteFlightFamilyCoupon({
      fare: { fareType: 'PUBLISH', price: { amount: 4183 } },
      priced,
      coupon: { adjustmentType: 'PERCENTAGE', value: 10, maxAmount: 100, currency: 'INR' },
      passengers: 2,
    });
    assert.equal(percent.couponSavings, 100);
    assert.equal(percent.total, 8266);
  });

  it('keeps a fixed DSA markup and an APL ceiling inside the payable', () => {
    const rules = [
      rule({ _id: 'apl', ruleKind: RULE_KINDS.APL_MARKUP, adjustmentType: 'FIXED', value: 200, currency: 'INR' }),
      rule({
        _id: 'ceil',
        ruleKind: RULE_KINDS.DSA_MARKUP_CEILING,
        adjustmentType: 'FIXED',
        value: 150,
        currency: 'INR',
      }),
      rule({
        _id: 'dsa',
        ruleKind: RULE_KINDS.DSA_MARKUP,
        ownerScope: 'DSA',
        dsaId: 'dsa1',
        adjustmentType: 'FIXED',
        value: 400,
        currency: 'INR',
      }),
    ];
    const priced = pricedFrom(4000, rules);
    assert.equal(priced.commercialSnapshot.aplMarkup.amount, 200);
    assert.equal(priced.commercialSnapshot.dsaMarkup.amount, 0);
    assert.equal(priced.commercialSnapshot.ceilingBlocked, true);
    const quote = quoteFlightFamilyCoupon({
      fare: { fareType: 'SAVER', price: { amount: priced.customerPrice.amount } },
      priced,
      coupon: { adjustmentType: 'FIXED', value: 100, currency: 'INR' },
      passengers: 1,
    });
    assert.equal(quote.couponStatus, 'COUPON_NO_REMAINING_MARGIN');
    assert.equal(quote.total, quote.fare);
    const allowed = pricedFrom(4000, [
      rule({ _id: 'apl2', ruleKind: RULE_KINDS.APL_MARKUP, adjustmentType: 'FIXED', value: 200, currency: 'INR' }),
      rule({
        _id: 'ceil2',
        ruleKind: RULE_KINDS.DSA_MARKUP_CEILING,
        adjustmentType: 'FIXED',
        value: 500,
        currency: 'INR',
      }),
      rule({
        _id: 'dsa2',
        ruleKind: RULE_KINDS.DSA_MARKUP,
        ownerScope: 'DSA',
        dsaId: 'dsa1',
        adjustmentType: 'FIXED',
        value: 400,
        currency: 'INR',
      }),
    ]);
    assert.equal(allowed.commercialSnapshot.dsaMarkup.amount, 400);
    const applied = quoteFlightFamilyCoupon({
      fare: { fareType: 'SAVER', price: { amount: allowed.customerPrice.amount } },
      priced: allowed,
      coupon: { adjustmentType: 'FIXED', value: 100, currency: 'INR' },
      passengers: 2,
    });
    assert.equal(applied.couponSavings, 100);
    assert.equal(applied.total, allowed.customerPrice.amount * 2 - 100);
  });

  it('rejects an exclusive coupon when an automatic discount is already applied', () => {
    const priced = pricedFrom(3500, markupRules);
    priced.commercialSnapshot.discount = { amount: 50, currency: 'INR' };
    const quote = quoteFlightFamilyCoupon({
      fare: { fareType: 'PUBLISH', price: { amount: 4183 } },
      priced,
      coupon: { adjustmentType: 'FIXED', value: 100, currency: 'INR', exclusive: true },
      passengers: 2,
    });
    assert.equal(quote.couponStatus, 'COUPON_CANNOT_COMBINE');
    assert.equal(quote.couponSavings, 0);
    assert.equal(quote.total, 8366);
  });

  it('selects the requested fare family and ignores the first offer', () => {
    const results = {
      flights: [{
        aplFlightId: 'flight-1',
        flightFareData: [
          { aplFareId: 'saver', fareType: 'SAVER', supplierPrice: { amount: 3000, currency: 'INR' } },
          { aplFareId: 'publish', fareType: 'PUBLISH', supplierPrice: { amount: 3000, currency: 'INR' } },
        ],
      }],
    };
    assert.equal(findFlightFare(results, 'publish').fare.fareType, 'PUBLISH');
    assert.equal(findFlightFare(results, 'flight-1'), null);
    assert.equal(findFlightFare(results, 'missing'), null);
  });
});
