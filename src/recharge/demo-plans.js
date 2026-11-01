'use strict';

/**
 * Fictional demonstration plans for local development.
 * These are not current operator tariffs and are not fetched from a supplier.
 * A live plan provider can replace listDemoPlans / findDemoPlan later.
 */

const NOTICE = 'DEMO / MOCK. Fictional demonstration plan. Not a current operator tariff. No recharge or bill was sent to a telecom provider.';

function plan(row) {
  return {
    currency: 'INR',
    demo: true,
    calls: 'Demo voice',
    sms: 'Demo SMS',
    notice: NOTICE,
    ...row,
  };
}

const PLANS = [
  plan({ id: 'JIO-199', operatorCode: 'JIO', country: 'IN', lineType: 'PREPAID', amount: 199, validity: '28 days', data: '2 GB total', category: 'DATA', description: 'Short data demonstration pack' }),
  plan({ id: 'JIO-299', operatorCode: 'JIO', country: 'IN', lineType: 'PREPAID', amount: 299, validity: '28 days', data: '1 GB/day', calls: 'Unlimited demo calls', category: 'POPULAR', description: 'Popular monthly demonstration pack' }),
  plan({ id: 'JIO-349', operatorCode: 'JIO', country: 'IN', lineType: 'PREPAID', amount: 349, validity: '28 days', data: '2 GB/day', calls: 'Unlimited demo calls', category: 'UNLIMITED', description: 'Higher daily data demonstration pack' }),
  plan({ id: 'JIO-599', operatorCode: 'JIO', country: 'IN', lineType: 'PREPAID', amount: 599, validity: '56 days', data: '1.5 GB/day', calls: 'Unlimited demo calls', category: 'LONG', description: 'Longer validity demonstration pack' }),
  plan({ id: 'JIO-899', operatorCode: 'JIO', country: 'IN', lineType: 'PREPAID', amount: 899, validity: '84 days', data: '2 GB/day', calls: 'Unlimited demo calls', category: 'POPULAR', description: 'Long validity demonstration pack' }),
  plan({ id: 'JIO-99', operatorCode: 'JIO', country: 'IN', lineType: 'PREPAID', amount: 99, validity: '18 days', data: 'No data pack', calls: 'Demo talktime', sms: '100 demo SMS', category: 'TALKTIME', description: 'Talktime demonstration pack' }),
  plan({ id: 'JIO-239', operatorCode: 'JIO', country: 'IN', lineType: 'PREPAID', amount: 239, validity: '28 days', data: '1.5 GB/day', calls: 'Unlimited demo calls', category: 'DATA', description: 'Existing demonstration pack kept for prior recharge checks' }),

  plan({ id: 'AIRTEL-219', operatorCode: 'AIRTEL', country: 'IN', lineType: 'PREPAID', amount: 219, validity: '28 days', data: '1 GB total', category: 'DATA', description: 'Airtel data demonstration pack' }),
  plan({ id: 'AIRTEL-319', operatorCode: 'AIRTEL', country: 'IN', lineType: 'PREPAID', amount: 319, validity: '28 days', data: '1.5 GB/day', calls: 'Unlimited demo calls', category: 'POPULAR', description: 'Airtel popular demonstration pack' }),
  plan({ id: 'AIRTEL-379', operatorCode: 'AIRTEL', country: 'IN', lineType: 'PREPAID', amount: 379, validity: '28 days', data: '2 GB/day', calls: 'Unlimited demo calls', category: 'UNLIMITED', description: 'Airtel unlimited demonstration pack' }),
  plan({ id: 'AIRTEL-666', operatorCode: 'AIRTEL', country: 'IN', lineType: 'PREPAID', amount: 666, validity: '84 days', data: '1.5 GB/day', calls: 'Unlimited demo calls', category: 'LONG', description: 'Airtel long-validity demonstration pack' }),
  plan({ id: 'AIRTEL-79', operatorCode: 'AIRTEL', country: 'IN', lineType: 'PREPAID', amount: 79, validity: '14 days', data: 'No data pack', calls: 'Demo talktime', category: 'TALKTIME', description: 'Airtel talktime demonstration pack' }),

  plan({ id: 'VI-179', operatorCode: 'VI', country: 'IN', lineType: 'PREPAID', amount: 179, validity: '28 days', data: '1 GB total', category: 'DATA', description: 'Vi data demonstration pack' }),
  plan({ id: 'VI-269', operatorCode: 'VI', country: 'IN', lineType: 'PREPAID', amount: 269, validity: '28 days', data: '1 GB/day', calls: 'Unlimited demo calls', category: 'POPULAR', description: 'Vi popular demonstration pack' }),
  plan({ id: 'VI-359', operatorCode: 'VI', country: 'IN', lineType: 'PREPAID', amount: 359, validity: '28 days', data: '1.5 GB/day', calls: 'Unlimited demo calls', category: 'UNLIMITED', description: 'Vi unlimited demonstration pack' }),
  plan({ id: 'VI-539', operatorCode: 'VI', country: 'IN', lineType: 'PREPAID', amount: 539, validity: '56 days', data: '1.5 GB/day', calls: 'Unlimited demo calls', category: 'LONG', description: 'Vi long-validity demonstration pack' }),
  plan({ id: 'VI-49', operatorCode: 'VI', country: 'IN', lineType: 'PREPAID', amount: 49, validity: '7 days', data: 'No data pack', calls: 'Demo talktime', category: 'TALKTIME', description: 'Vi talktime demonstration pack' }),

  plan({ id: 'BSNL-187', operatorCode: 'BSNL', country: 'IN', lineType: 'PREPAID', amount: 187, validity: '28 days', data: '2 GB total', category: 'DATA', description: 'BSNL data demonstration pack' }),
  plan({ id: 'BSNL-249', operatorCode: 'BSNL', country: 'IN', lineType: 'PREPAID', amount: 249, validity: '28 days', data: '1 GB/day', calls: 'Unlimited demo calls', category: 'POPULAR', description: 'BSNL popular demonstration pack' }),
  plan({ id: 'BSNL-397', operatorCode: 'BSNL', country: 'IN', lineType: 'PREPAID', amount: 397, validity: '30 days', data: '2 GB/day', calls: 'Unlimited demo calls', category: 'UNLIMITED', description: 'BSNL unlimited demonstration pack' }),
  plan({ id: 'BSNL-497', operatorCode: 'BSNL', country: 'IN', lineType: 'PREPAID', amount: 497, validity: '60 days', data: '1 GB/day', calls: 'Unlimited demo calls', category: 'LONG', description: 'BSNL long-validity demonstration pack' }),
  plan({ id: 'BSNL-110', operatorCode: 'BSNL', country: 'IN', lineType: 'PREPAID', amount: 110, validity: '21 days', data: 'No data pack', calls: 'Demo talktime', category: 'TALKTIME', description: 'BSNL talktime demonstration pack' }),

  plan({ id: 'MTNL-149', operatorCode: 'MTNL', country: 'IN', lineType: 'PREPAID', amount: 149, validity: '28 days', data: '1 GB total', category: 'DATA', description: 'MTNL Delhi/Mumbai demonstration pack' }),
  plan({ id: 'MTNL-219', operatorCode: 'MTNL', country: 'IN', lineType: 'PREPAID', amount: 219, validity: '28 days', data: '1 GB/day', calls: 'Unlimited demo calls', category: 'POPULAR', description: 'MTNL popular demonstration pack' }),
  plan({ id: 'MTNL-329', operatorCode: 'MTNL', country: 'IN', lineType: 'PREPAID', amount: 329, validity: '56 days', data: '1 GB/day', calls: 'Unlimited demo calls', category: 'LONG', description: 'MTNL long-validity demonstration pack' }),

  plan({ id: 'JIO-POST-499', operatorCode: 'JIO', country: 'IN', lineType: 'POSTPAID', amount: 499, validity: 'Sample cycle', data: 'Sample usage', calls: 'Sample voice', category: 'BILL', description: 'Demonstration bill option. No real bill was fetched.' }),
  plan({ id: 'JIO-POST-799', operatorCode: 'JIO', country: 'IN', lineType: 'POSTPAID', amount: 799, validity: 'Sample cycle', data: 'Sample usage', calls: 'Sample voice', category: 'BILL', description: 'Higher demonstration bill option. No real bill was fetched.' }),
  plan({ id: 'AIRTEL-POST-549', operatorCode: 'AIRTEL', country: 'IN', lineType: 'POSTPAID', amount: 549, validity: 'Sample cycle', data: 'Sample usage', category: 'BILL', description: 'Demonstration bill option. No real bill was fetched.' }),
  plan({ id: 'AIRTEL-POST-999', operatorCode: 'AIRTEL', country: 'IN', lineType: 'POSTPAID', amount: 999, validity: 'Sample cycle', data: 'Sample usage', category: 'BILL', description: 'Higher demonstration bill option. No real bill was fetched.' }),
  plan({ id: 'VI-POST-449', operatorCode: 'VI', country: 'IN', lineType: 'POSTPAID', amount: 449, validity: 'Sample cycle', data: 'Sample usage', category: 'BILL', description: 'Demonstration bill option. No real bill was fetched.' }),
  plan({ id: 'VI-POST-699', operatorCode: 'VI', country: 'IN', lineType: 'POSTPAID', amount: 699, validity: 'Sample cycle', data: 'Sample usage', category: 'BILL', description: 'Higher demonstration bill option. No real bill was fetched.' }),
  plan({ id: 'BSNL-POST-399', operatorCode: 'BSNL', country: 'IN', lineType: 'POSTPAID', amount: 399, validity: 'Sample cycle', data: 'Sample usage', category: 'BILL', description: 'Demonstration bill option. No real bill was fetched.' }),
  plan({ id: 'MTNL-POST-299', operatorCode: 'MTNL', country: 'IN', lineType: 'POSTPAID', amount: 299, validity: 'Sample cycle', data: 'Sample usage', category: 'BILL', description: 'Demonstration bill option. No real bill was fetched.' }),
  plan({ id: 'JIO-DELHI-155', operatorCode: 'JIO', country: 'IN', lineType: 'PREPAID', amount: 155, validity: '24 days', data: '1 GB/day', calls: 'Unlimited demo calls', category: 'POPULAR', description: 'Delhi NCR demonstration pack', circles: ['DELHI'] }),
  plan({ id: 'JIO-MUMBAI-175', operatorCode: 'JIO', country: 'IN', lineType: 'PREPAID', amount: 175, validity: '28 days', data: '1.5 GB/day', calls: 'Unlimited demo calls', category: 'DATA', description: 'Mumbai demonstration pack', circles: ['MUMBAI'] }),
  plan({ id: 'AIRTEL-KA-255', operatorCode: 'AIRTEL', country: 'IN', lineType: 'PREPAID', amount: 255, validity: '28 days', data: '1 GB/day', calls: 'Unlimited demo calls', category: 'DATA', description: 'Karnataka demonstration pack', circles: ['KA'] }),
  plan({ id: 'VI-TN-165', operatorCode: 'VI', country: 'IN', lineType: 'PREPAID', amount: 165, validity: '28 days', data: '1 GB total', category: 'DATA', description: 'Tamil Nadu demonstration pack', circles: ['TN'] }),
  plan({ id: 'BSNL-KL-139', operatorCode: 'BSNL', country: 'IN', lineType: 'PREPAID', amount: 139, validity: '28 days', data: '1 GB total', category: 'DATA', description: 'Kerala demonstration pack', circles: ['KL'] }),
];

function listDemoPlans({ country, operatorCode, lineType, circle }) {
  const iso = String(country || '').toUpperCase();
  const code = String(operatorCode || '').toUpperCase();
  const type = String(lineType || '').toUpperCase();
  const region = String(circle || '').toUpperCase();
  return PLANS.filter((row) => {
    if (row.country !== iso || row.operatorCode !== code || row.lineType !== type) return false;
    if (!region) return !row.circles;
    if (!row.circles || !row.circles.length) return true;
    return row.circles.includes(region);
  });
}

function findDemoPlan({ country, operatorCode, lineType, planId, circle }) {
  return listDemoPlans({ country, operatorCode, lineType, circle }).find((row) => row.id === planId) || null;
}

module.exports = {
  listDemoPlans,
  findDemoPlan,
};
