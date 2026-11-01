'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { listDemoPlans, findDemoPlan } = require('./demo-plans');
const { MOBILE_OPERATORS } = require('./catalogue');
const { plansFor } = require('./services/recharge.service');

describe('demo recharge plans', () => {
  it('lists India operators with display names and no French catalogue', () => {
    assert.deepEqual(MOBILE_OPERATORS.IN.map((row) => row.name), [
      'Reliance Jio',
      'Bharti Airtel',
      'Vodafone Idea (Vi)',
      'BSNL',
      'MTNL',
    ]);
    assert.equal(MOBILE_OPERATORS.FR, undefined);
    assert.match(MOBILE_OPERATORS.US[0].note, /No live recharge connection/);
  });

  it('returns operator-specific prepaid plans and rejects a mismatched id', () => {
    const jio = listDemoPlans({ country: 'IN', operatorCode: 'JIO', lineType: 'PREPAID', circle: 'DELHI' });
    const mumbai = listDemoPlans({ country: 'IN', operatorCode: 'JIO', lineType: 'PREPAID', circle: 'MUMBAI' });
    const airtel = listDemoPlans({ country: 'IN', operatorCode: 'AIRTEL', lineType: 'PREPAID', circle: 'DELHI' });
    assert.ok(jio.some((row) => row.id === 'JIO-DELHI-155'));
    assert.equal(mumbai.some((row) => row.id === 'JIO-DELHI-155'), false);
    assert.notDeepEqual(jio.map((row) => row.id), airtel.map((row) => row.id));
    assert.equal(jio.every((row) => row.demo === true), true);
    assert.equal(findDemoPlan({ country: 'IN', operatorCode: 'AIRTEL', lineType: 'PREPAID', planId: 'JIO-199', circle: 'DELHI' }), null);
  });

  it('serves postpaid demo bills without a live fetch and leaves unsupported operators empty', () => {
    const bills = plansFor('IN', 'JIO', 'POSTPAID', 'DELHI');
    assert.equal(bills.live, false);
    assert.equal(bills.circle.code, 'DELHI');
    assert.match(bills.plans[0].description, /No real bill was fetched/);
    const usa = plansFor('US', 'VERIZON', 'PREPAID');
    assert.deepEqual(usa.plans, []);
    assert.throws(() => plansFor('IN', 'MTNL', 'PREPAID', 'KA'), /region or circle/);
  });
});
