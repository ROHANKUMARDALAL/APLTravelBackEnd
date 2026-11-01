'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { catalogWindow, publicCouponCard } = require('./services/coupon.service');

describe('public coupon catalogue window', () => {
  const now = new Date('2026-10-29T12:00:00Z');

  it('keeps an active in-window coupon open', () => {
    assert.equal(catalogWindow({
      status: 'ACTIVE',
      startsAt: '2026-10-01T00:00:00Z',
      endsAt: '2026-11-01T00:00:00Z',
      usedCount: 1,
      totalLimit: 5,
    }, now), 'OPEN');
  });

  it('rejects inactive, expired, future, and exhausted coupons', () => {
    assert.equal(catalogWindow({ status: 'INACTIVE' }, now), 'INVALID');
    assert.equal(catalogWindow(null, now), 'INVALID');
    assert.equal(catalogWindow({ status: 'EXPIRED' }, now), 'EXPIRED');
    assert.equal(catalogWindow({ status: 'ACTIVE', endsAt: '2026-10-01T00:00:00Z' }, now), 'EXPIRED');
    assert.equal(catalogWindow({ status: 'ACTIVE', startsAt: '2026-12-01T00:00:00Z' }, now), 'EXPIRED');
    assert.equal(catalogWindow({ status: 'ACTIVE', usedCount: 2, totalLimit: 2 }, now), 'LIMIT');
  });

  it('publishes the stored discount without customer restrictions', () => {
    const card = publicCouponCard({
      code: 'HARBOR10',
      name: 'Harbor flight',
      description: 'Selected flights',
      serviceCode: 'flight',
      adjustmentType: 'PERCENTAGE',
      value: 10,
      currency: 'INR',
      maxAmount: 500,
      minAmount: 1000,
      endsAt: '2026-11-01T00:00:00Z',
      firstBookingOnly: false,
      exclusive: true,
      originCode: 'DEL',
      customerIds: ['hidden'],
    });
    assert.equal(card.code, 'HARBOR10');
    assert.equal(card.value, 10);
    assert.equal(card.routeLimited, true);
    assert.equal(card.customerIds, undefined);
  });
});
