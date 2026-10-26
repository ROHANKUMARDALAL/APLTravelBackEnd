'use strict';

/**
 * Mock recharge catalogues. Provider names are real companies used as labels
 * for a demonstration. Nothing here contacts an operator or moves money.
 */

const MOBILE_OPERATORS = {
  IN: [
    { code: 'JIO', name: 'Jio' },
    { code: 'AIRTEL', name: 'Airtel' },
    { code: 'VI', name: 'Vi' },
    { code: 'BSNL', name: 'BSNL' },
  ],
  US: [
    { code: 'VERIZON', name: 'Verizon' },
    { code: 'ATT', name: 'AT&T' },
    { code: 'TMOBILE', name: 'T-Mobile' },
  ],
  GB: [
    { code: 'EE', name: 'EE' },
    { code: 'O2', name: 'O2' },
    { code: 'VODAFONE_UK', name: 'Vodafone' },
    { code: 'THREE_UK', name: 'Three' },
  ],
  AE: [
    { code: 'ETISALAT', name: 'Etisalat' },
    { code: 'DU', name: 'du' },
  ],
  SG: [
    { code: 'SINGTEL', name: 'Singtel' },
    { code: 'STARHUB', name: 'StarHub' },
    { code: 'M1', name: 'M1' },
  ],
};

const PREPAID_PLANS = {
  JIO: [
    { id: 'JIO-239', amount: 239, validity: '28 days', data: '1.5 GB/day', calls: 'Unlimited', benefits: 'Mock data pack' },
    { id: 'JIO-666', amount: 666, validity: '84 days', data: '1.5 GB/day', calls: 'Unlimited', benefits: 'Mock long-validity pack' },
    { id: 'JIO-2999', amount: 2999, validity: '365 days', data: '2.5 GB/day', calls: 'Unlimited', benefits: 'Mock annual pack' },
  ],
  AIRTEL: [
    { id: 'AIRTEL-299', amount: 299, validity: '28 days', data: '1.5 GB/day', calls: 'Unlimited', benefits: 'Mock data pack' },
    { id: 'AIRTEL-859', amount: 859, validity: '84 days', data: '1.5 GB/day', calls: 'Unlimited', benefits: 'Mock long-validity pack' },
  ],
  VI: [
    { id: 'VI-299', amount: 299, validity: '28 days', data: '1.5 GB/day', calls: 'Unlimited', benefits: 'Mock data pack' },
    { id: 'VI-719', amount: 719, validity: '56 days', data: '1.5 GB/day', calls: 'Unlimited', benefits: 'Mock data pack' },
  ],
  BSNL: [
    { id: 'BSNL-199', amount: 199, validity: '28 days', data: '2 GB/day', calls: 'Unlimited', benefits: 'Mock data pack' },
    { id: 'BSNL-397', amount: 397, validity: '30 days', data: '2 GB/day', calls: 'Unlimited', benefits: 'Mock data pack' },
  ],
};

const BROADBAND = [
  { code: 'JIOFIBER', name: 'JioFiber', accountLabel: 'Registered mobile or JioFiber ID' },
  { code: 'AIRTEL_XSTREAM', name: 'Airtel Xstream Fiber', accountLabel: 'Registered mobile or account ID' },
  { code: 'BSNL_FTTH', name: 'BSNL Bharat Fiber', accountLabel: 'Customer ID or landline' },
  { code: 'ACT', name: 'ACT Fibernet', accountLabel: 'Account ID' },
  { code: 'EXCITEL', name: 'Excitel', accountLabel: 'User ID or registered mobile' },
  { code: 'HATHWAY', name: 'Hathway', accountLabel: 'Customer ID' },
  { code: 'TATA_PLAY_FIBER', name: 'Tata Play Fiber', accountLabel: 'Customer ID or registered mobile' },
];

const ELECTRICITY = [
  { state: 'Uttar Pradesh', code: 'PVVNL', name: 'Paschimanchal Vidyut Vitran Nigam Limited' },
  { state: 'Uttar Pradesh', code: 'PUVVNL', name: 'Purvanchal Vidyut Vitran Nigam Limited' },
  { state: 'Uttar Pradesh', code: 'MVVNL', name: 'Madhyanchal Vidyut Vitran Nigam Limited' },
  { state: 'Uttar Pradesh', code: 'DVVNL', name: 'Dakshinanchal Vidyut Vitran Nigam Limited' },
  { state: 'Uttar Pradesh', code: 'KESCO', name: 'Kanpur Electricity Supply Company Limited' },
  { state: 'Maharashtra', code: 'MSEDCL', name: 'Maharashtra State Electricity Distribution Company Limited' },
  { state: 'Delhi', code: 'BSES_RAJDHANI', name: 'BSES Rajdhani Power Limited' },
  { state: 'Delhi', code: 'BSES_YAMUNA', name: 'BSES Yamuna Power Limited' },
  { state: 'Delhi', code: 'TPDDL', name: 'Tata Power Delhi Distribution Limited' },
  { state: 'Delhi', code: 'NDMC', name: 'New Delhi Municipal Council' },
  { state: 'Karnataka', code: 'BESCOM', name: 'Bangalore Electricity Supply Company Limited' },
  { state: 'Tamil Nadu', code: 'TANGEDCO', name: 'Tamil Nadu Generation and Distribution Corporation Limited' },
  { state: 'West Bengal', code: 'WBSEDCL', name: 'West Bengal State Electricity Distribution Company Limited' },
  { state: 'Gujarat', code: 'DGVCL', name: 'Dakshin Gujarat Vij Company Limited' },
  { state: 'Gujarat', code: 'UGVCL', name: 'Uttar Gujarat Vij Company Limited' },
  { state: 'Gujarat', code: 'MGVCL', name: 'Madhya Gujarat Vij Company Limited' },
  { state: 'Gujarat', code: 'PGVCL', name: 'Paschim Gujarat Vij Company Limited' },
  { state: 'Rajasthan', code: 'JVVNL', name: 'Jaipur Vidyut Vitran Nigam Limited' },
  { state: 'Rajasthan', code: 'AVVNL', name: 'Ajmer Vidyut Vitran Nigam Limited' },
  { state: 'Rajasthan', code: 'JDVVNL', name: 'Jodhpur Vidyut Vitran Nigam Limited' },
  { state: 'Uttarakhand', code: 'UPCL', name: 'Uttarakhand Power Corporation Limited' },
  { state: 'Punjab', code: 'PSPCL', name: 'Punjab State Power Corporation Limited' },
  { state: 'Kerala', code: 'KSEBL', name: 'Kerala State Electricity Board Limited' },
  { state: 'Telangana', code: 'TSSPDCL', name: 'Telangana State Southern Power Distribution Company Limited' },
  { state: 'Telangana', code: 'TSNPDCL', name: 'Telangana State Northern Power Distribution Company Limited' },
];

const GAS = [
  { code: 'IGL', name: 'Indraprastha Gas Limited', category: 'Piped natural gas', accountLabel: 'BP number' },
  { code: 'MGL', name: 'Mahanagar Gas Limited', category: 'Piped natural gas', accountLabel: 'CA number' },
  { code: 'GUJARAT_GAS', name: 'Gujarat Gas Limited', category: 'Piped natural gas', accountLabel: 'Consumer number' },
  { code: 'ADANI_GAS', name: 'Adani Total Gas Limited', category: 'Piped natural gas', accountLabel: 'Customer ID' },
  { code: 'GAIL_GAS', name: 'GAIL Gas Limited', category: 'Piped natural gas', accountLabel: 'Customer number' },
  { code: 'IOCL', name: 'Indian Oil Corporation Limited (Indane)', category: 'LPG', accountLabel: 'Consumer number' },
  { code: 'HPCL', name: 'Hindustan Petroleum Corporation Limited', category: 'LPG', accountLabel: 'Consumer number' },
  { code: 'BPCL', name: 'Bharat Petroleum Corporation Limited', category: 'LPG', accountLabel: 'Consumer number' },
];

const METROS = [
  { code: 'DMRC', name: 'Delhi Metro', city: 'Delhi', identifier: 'Metro card number', note: 'Demonstration only. This does not update a Delhi Metro card balance.' },
  { code: 'NMRC', name: 'Noida Metro', city: 'Noida', identifier: 'Card or account number', note: 'Demonstration only. Noida Metro recharge methods differ from this form.' },
  { code: 'MMRCL', name: 'Mumbai Metro', city: 'Mumbai', identifier: 'Card or account number', note: 'Demonstration only. This is not a Mumbai Metro top-up.' },
  { code: 'KMRL', name: 'Kolkata Metro', city: 'Kolkata', identifier: 'Card number', note: 'Demonstration only. This does not recharge a Kolkata Metro card.' },
  { code: 'CMRL', name: 'Chennai Metro', city: 'Chennai', identifier: 'Card number', note: 'Demonstration only. This does not recharge a Chennai Metro card.' },
  { code: 'JMRC', name: 'Jaipur Metro', city: 'Jaipur', identifier: 'Card number', note: 'Demonstration only. This does not recharge a Jaipur Metro card.' },
  { code: 'KANPUR_METRO', name: 'Kanpur Metro', city: 'Kanpur', identifier: 'Card or account number', note: 'Demonstration only. This does not recharge a Kanpur Metro card.' },
  { code: 'LMRC', name: 'Lucknow Metro', city: 'Lucknow', identifier: 'Card number', note: 'Demonstration only. This does not recharge a Lucknow Metro card.' },
];

function demoAmount(seed) {
  const text = String(seed || '0');
  const sum = [...text].reduce((total, char) => total + char.charCodeAt(0), 0);
  return 120 + (sum % 4800);
}

function billingWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const due = new Date(end.getTime() + 12 * 24 * 60 * 60 * 1000);
  const format = (value) => value.toISOString().slice(0, 10);
  return { period: `${format(start)} to ${format(end)}`, dueDate: format(due) };
}

module.exports = {
  MOBILE_OPERATORS,
  PREPAID_PLANS,
  BROADBAND,
  ELECTRICITY,
  GAS,
  METROS,
  demoAmount,
  billingWindow,
};
