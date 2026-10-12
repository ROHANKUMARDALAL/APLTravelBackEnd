'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toMinor, toMajor, percentOfMinor } = require('./money');
const {
  calculatePrice,
  pickBestRule,
  RULE_KINDS,
} = require('./services/pricing-engine.service');

function rule(partial) {
  return {
    _id: partial._id || 'r1',
    name: partial.name || 'rule',
    status: 'ACTIVE',
    priority: partial.priority || 100,
    ownerScope: partial.ownerScope || 'PLATFORM',
    dsaId: partial.dsaId || null,
    serviceCode: partial.serviceCode || null,
    supplierCode: partial.supplierCode || null,
    tripType: null,
    effectiveFrom: null,
    effectiveTo: null,
    ...partial,
  };
}

describe('Phase 12 money', () => {
  it('16) avoids float drift for common INR amounts', () => {
    assert.equal(toMinor(4315.9), 431590);
    assert.equal(toMajor(431590), 4315.9);
    assert.equal(toMajor(percentOfMinor(toMinor(10000), 2.5)), 250);
  });
});

describe('Phase 12 pricing engine', () => {
  it('1+2+6+7+8) APL percent + DSA + fee preserve supplier and separate components', () => {
    const rules = [
      rule({
        _id: 'apl',
        ruleKind: RULE_KINDS.APL_MARKUP,
        adjustmentType: 'PERCENTAGE',
        value: 2,
        serviceCode: 'flight',
      }),
      rule({
        _id: 'ceil',
        ruleKind: RULE_KINDS.DSA_MARKUP_CEILING,
        adjustmentType: 'PERCENTAGE',
        value: 5,
        serviceCode: 'flight',
      }),
      rule({
        _id: 'dsa',
        ruleKind: RULE_KINDS.DSA_MARKUP,
        ownerScope: 'DSA',
        dsaId: 'dsa1',
        adjustmentType: 'PERCENTAGE',
        value: 3,
        serviceCode: 'flight',
      }),
      rule({
        _id: 'fee',
        ruleKind: RULE_KINDS.SERVICE_FEE,
        adjustmentType: 'FIXED',
        value: 100,
        currency: 'INR',
        serviceCode: 'flight',
      }),
    ];
    const out = calculatePrice({
      supplierPrice: { amount: 10000, currency: 'INR' },
      supplierCode: 'TBO',
      context: {
        rules,
        dsaId: 'dsa1',
        serviceCode: 'flight',
        at: new Date(),
        pricingVersion: '12.0',
      },
    });
    assert.equal(out.supplierPrice.amount, 10000);
    assert.equal(out.commercialSnapshot.aplMarkup.amount, 200);
    assert.equal(out.commercialSnapshot.dsaMarkup.amount, 300);
    assert.equal(out.commercialSnapshot.serviceFee.amount, 100);
    assert.equal(out.customerPrice.amount, 10600);
  });

  it('2) fixed APL markup', () => {
    const out = calculatePrice({
      supplierPrice: { amount: 5000, currency: 'INR' },
      context: {
        rules: [
          rule({
            ruleKind: RULE_KINDS.APL_MARKUP,
            adjustmentType: 'FIXED',
            value: 150,
            currency: 'INR',
          }),
        ],
        serviceCode: 'flight',
        at: new Date(),
      },
    });
    assert.equal(out.customerPrice.amount, 5150);
  });

  it('4) DSA ceiling blocks higher markup', () => {
    const out = calculatePrice({
      supplierPrice: { amount: 10000, currency: 'INR' },
      context: {
        dsaId: 'dsa1',
        serviceCode: 'flight',
        at: new Date(),
        rules: [
          rule({
            ruleKind: RULE_KINDS.DSA_MARKUP_CEILING,
            adjustmentType: 'PERCENTAGE',
            value: 5,
          }),
          rule({
            _id: 'dsa',
            ruleKind: RULE_KINDS.DSA_MARKUP,
            ownerScope: 'DSA',
            dsaId: 'dsa1',
            adjustmentType: 'PERCENTAGE',
            value: 7,
          }),
        ],
      },
    });
    assert.equal(out.commercialSnapshot.dsaMarkup.amount, 0);
    assert.equal(out.commercialSnapshot.ceilingBlocked, true);
  });

  it('9) more specific supplier rule wins', () => {
    const rules = [
      rule({
        _id: 'global',
        ruleKind: RULE_KINDS.APL_MARKUP,
        adjustmentType: 'PERCENTAGE',
        value: 10,
        priority: 1,
      }),
      rule({
        _id: 'tbo',
        ruleKind: RULE_KINDS.APL_MARKUP,
        adjustmentType: 'PERCENTAGE',
        value: 1.5,
        serviceCode: 'flight',
        supplierCode: 'TBO',
        priority: 1,
      }),
    ];
    const picked = pickBestRule(rules, RULE_KINDS.APL_MARKUP, {
      dsaId: null,
      serviceCode: 'flight',
      supplierCode: 'TBO',
      tripType: null,
      at: new Date(),
    });
    assert.equal(picked._id, 'tbo');
  });

  it('11) inactive ignored', () => {
    const out = calculatePrice({
      supplierPrice: { amount: 1000, currency: 'INR' },
      context: {
        at: new Date(),
        serviceCode: 'flight',
        rules: [
          rule({
            ruleKind: RULE_KINDS.APL_MARKUP,
            adjustmentType: 'PERCENTAGE',
            value: 50,
            status: 'INACTIVE',
          }),
        ],
      },
    });
    assert.equal(out.customerPrice.amount, 1000);
  });

  it('15) fixed currency mismatch skipped safely', () => {
    const out = calculatePrice({
      supplierPrice: { amount: 1000, currency: 'INR' },
      context: {
        at: new Date(),
        rules: [
          rule({
            ruleKind: RULE_KINDS.APL_MARKUP,
            adjustmentType: 'FIXED',
            value: 50,
            currency: 'USD',
          }),
        ],
      },
    });
    assert.equal(out.customerPrice.amount, 1000);
    assert.equal(out.commercialSnapshot.appliedRules[0].skipReason, 'CURRENCY_MISMATCH');
  });

  it('12) wrong service ignored', () => {
    const out = calculatePrice({
      supplierPrice: { amount: 1000, currency: 'INR' },
      context: {
        at: new Date(),
        serviceCode: 'flight',
        rules: [
          rule({
            ruleKind: RULE_KINDS.APL_MARKUP,
            adjustmentType: 'PERCENTAGE',
            value: 20,
            serviceCode: 'hotel',
          }),
        ],
      },
    });
    assert.equal(out.customerPrice.amount, 1000);
  });

  it('coupon applies only inside DSA margin after markup and discount', () => {
    const out = calculatePrice({
      supplierPrice: { amount: 1000, currency: 'INR' },
      context: {
        at: new Date(),
        dsaId: 'dsa1',
        serviceCode: 'flight',
        coupon: { code: 'SAVE50', adjustmentType: 'FIXED', value: 50, currency: 'INR' },
        rules: [
          rule({ ruleKind: RULE_KINDS.DSA_MARKUP, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'FIXED', value: 150, currency: 'INR' }),
          rule({ _id: 'd1', ruleKind: RULE_KINDS.DISCOUNT, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'FIXED', value: 100, currency: 'INR' }),
        ],
      },
    });
    assert.equal(out.commercialSnapshot.dsaMarkup.amount, 150);
    assert.equal(out.commercialSnapshot.discount.amount, 100);
    assert.equal(out.commercialSnapshot.coupon.amount, 50);
    assert.equal(out.commercialSnapshot.coupon.status, 'APPLIED');
    assert.equal(out.customerPrice.amount, 1000);
  });

  it('exclusive coupon does not stack with an automatic discount', () => {
    const out = calculatePrice({
      supplierPrice: { amount: 1000, currency: 'INR' },
      context: {
        at: new Date(),
        dsaId: 'dsa1',
        coupon: { code: 'ONLY', exclusive: true, adjustmentType: 'FIXED', value: 50, currency: 'INR' },
        rules: [
          rule({ ruleKind: RULE_KINDS.DSA_MARKUP, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'FIXED', value: 150, currency: 'INR' }),
          rule({ _id: 'd1', ruleKind: RULE_KINDS.DISCOUNT, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'FIXED', value: 100, currency: 'INR' }),
        ],
      },
    });
    assert.equal(out.commercialSnapshot.coupon.amount, 0);
    assert.equal(out.commercialSnapshot.coupon.status, 'COUPON_CANNOT_COMBINE');
    assert.equal(out.customerPrice.amount, 1050);
  });

  it('coupon cannot reduce the price below supplier plus APL markup', () => {
    const out = calculatePrice({
      supplierPrice: { amount: 1000, currency: 'INR' },
      context: {
        at: new Date(),
        dsaId: 'dsa1',
        coupon: { code: 'BIG', adjustmentType: 'FIXED', value: 500, currency: 'INR' },
        rules: [
          rule({ ruleKind: RULE_KINDS.APL_MARKUP, adjustmentType: 'FIXED', value: 20, currency: 'INR' }),
          rule({ _id: 'm1', ruleKind: RULE_KINDS.DSA_MARKUP, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'FIXED', value: 150, currency: 'INR' }),
        ],
      },
    });
    assert.equal(out.commercialSnapshot.coupon.amount, 150);
    assert.equal(out.customerPrice.amount, 1020);
  });

  it('percentage discount is the percent of the supplier fare when margin allows', () => {
    const out = calculatePrice({
      supplierPrice: { amount: 2000, currency: 'INR' },
      context: {
        at: new Date(),
        dsaId: 'dsa1',
        rules: [
          rule({ ruleKind: RULE_KINDS.DSA_MARKUP, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'FIXED', value: 500, currency: 'INR' }),
          rule({ _id: 'pct', ruleKind: RULE_KINDS.DISCOUNT, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'PERCENTAGE', value: 10 }),
        ],
      },
    });
    assert.equal(out.commercialSnapshot.discount.amount, 200);
    assert.equal(out.customerPrice.amount, 2300);
  });

  it('fixed markup stays inside a percentage ceiling using the supplier fare', () => {
    const within = calculatePrice({
      supplierPrice: { amount: 2000, currency: 'INR' },
      context: {
        dsaId: 'dsa1',
        serviceCode: 'flight',
        at: new Date(),
        rules: [
          rule({ ruleKind: RULE_KINDS.DSA_MARKUP_CEILING, adjustmentType: 'PERCENTAGE', value: 5 }),
          rule({ _id: 'dsa', ruleKind: RULE_KINDS.DSA_MARKUP, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'FIXED', value: 100, currency: 'INR' }),
        ],
      },
    });
    assert.equal(within.commercialSnapshot.dsaMarkup.amount, 100);
    assert.equal(within.commercialSnapshot.ceilingBlocked, false);
    const over = calculatePrice({
      supplierPrice: { amount: 2000, currency: 'INR' },
      context: {
        dsaId: 'dsa1',
        serviceCode: 'flight',
        at: new Date(),
        rules: [
          rule({ ruleKind: RULE_KINDS.DSA_MARKUP_CEILING, adjustmentType: 'PERCENTAGE', value: 5 }),
          rule({ _id: 'dsa', ruleKind: RULE_KINDS.DSA_MARKUP, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'FIXED', value: 150, currency: 'INR' }),
        ],
      },
    });
    assert.equal(over.commercialSnapshot.dsaMarkup.amount, 0);
    assert.equal(over.commercialSnapshot.ceilingBlocked, true);
  });
});

describe('Phase 16J maximum discount', () => {
  const headroom = rule({
    ruleKind: RULE_KINDS.DSA_MARKUP,
    ownerScope: 'DSA',
    dsaId: 'dsa1',
    adjustmentType: 'FIXED',
    value: 20000,
    currency: 'INR',
  });

  function price(amount, extraRules, coupon) {
    return calculatePrice({
      supplierPrice: { amount, currency: 'INR' },
      context: {
        dsaId: 'dsa1',
        serviceCode: 'flight',
        at: new Date(),
        rules: [headroom, ...extraRules],
        coupon,
      },
    });
  }

  it('keeps 5 percent of 1980 when the maximum is 100', () => {
    const out = price(1980, [
      rule({ ruleKind: RULE_KINDS.DISCOUNT, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'PERCENTAGE', value: 5, maxAmount: 100 }),
    ]);
    assert.equal(out.commercialSnapshot.discount.amount, 99);
    assert.equal(out.commercialSnapshot.discount.cappedByMaximum, false);
  });

  it('caps 5 percent of 2020 at 100', () => {
    const out = price(2020, [
      rule({ ruleKind: RULE_KINDS.DISCOUNT, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'PERCENTAGE', value: 5, maxAmount: 100 }),
    ]);
    assert.equal(out.commercialSnapshot.discount.amount, 100);
    assert.equal(out.commercialSnapshot.discount.cappedByMaximum, true);
  });

  it('caps a 10 percent coupon of 100000 at 500', () => {
    const out = price(100000, [], {
      code: 'SAVE10',
      adjustmentType: 'PERCENTAGE',
      value: 10,
      maxAmount: 500,
    });
    assert.equal(out.commercialSnapshot.coupon.amount, 500);
    assert.equal(out.commercialSnapshot.coupon.maxAmount, 500);
    assert.equal(out.commercialSnapshot.discount.amount, 0);
  });

  it('leaves a fixed discount unchanged when a maximum is stored', () => {
    const out = price(2000, [
      rule({ ruleKind: RULE_KINDS.DISCOUNT, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'FIXED', value: 200, currency: 'INR', maxAmount: 50 }),
    ]);
    assert.equal(out.commercialSnapshot.discount.amount, 200);
    assert.equal(out.commercialSnapshot.discount.cappedByMaximum, false);
  });

  it('does not treat a missing maximum as zero', () => {
    const out = price(1980, [
      rule({ ruleKind: RULE_KINDS.DISCOUNT, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'PERCENTAGE', value: 5, maxAmount: null }),
    ]);
    assert.equal(out.commercialSnapshot.discount.amount, 99);
  });

  it('applies the automatic cap and the coupon cap separately', () => {
    const out = price(2020, [
      rule({ ruleKind: RULE_KINDS.DISCOUNT, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'PERCENTAGE', value: 5, maxAmount: 100 }),
    ], {
      code: 'TEN',
      adjustmentType: 'PERCENTAGE',
      value: 10,
      maxAmount: 500,
    });
    assert.equal(out.commercialSnapshot.discount.amount, 100);
    assert.equal(out.commercialSnapshot.coupon.amount, 202);
  });

  it('still respects the DSA margin floor after the maximum', () => {
    const out = calculatePrice({
      supplierPrice: { amount: 1980, currency: 'INR' },
      context: {
        dsaId: 'dsa1',
        serviceCode: 'flight',
        at: new Date(),
        rules: [
          rule({ ruleKind: RULE_KINDS.DSA_MARKUP, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'FIXED', value: 50, currency: 'INR' }),
          rule({ ruleKind: RULE_KINDS.DISCOUNT, ownerScope: 'DSA', dsaId: 'dsa1', adjustmentType: 'PERCENTAGE', value: 5, maxAmount: 100 }),
        ],
      },
    });
    assert.equal(out.commercialSnapshot.discount.amount, 50);
    assert.equal(out.commercialSnapshot.discount.capped, true);
  });
});
