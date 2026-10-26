'use strict';

const crypto = require('crypto');
const { getCountries, getCountryCallingCode, isValidPhoneNumber } = require('libphonenumber-js');
const { AppError } = require('../../common/errors/app-error');
const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');
const RechargeOrder = require('../models/RechargeOrder');
const {
  MOBILE_OPERATORS,
  PREPAID_PLANS,
  BROADBAND,
  ELECTRICITY,
  GAS,
  METROS,
  demoAmount,
  billingWindow,
} = require('../catalogue');

const CATEGORIES = ['MOBILE', 'BROADBAND', 'ELECTRICITY', 'GAS', 'METRO'];
const TEST_NOTICE = 'MOCK / TEST. No operator, utility, or metro system was contacted. No balance was changed.';

function maskAccount(value) {
  const text = String(value || '').replace(/\s+/g, '');
  if (text.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

function reference() {
  return `APL-RCH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function flag(iso) {
  return String(iso || '')
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function countries() {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return getCountries()
    .map((iso) => ({
      iso,
      name: names.of(iso) || iso,
      dialCode: `+${getCountryCallingCode(iso)}`,
      flag: flag(iso),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function catalogue() {
  const states = [...new Set(ELECTRICITY.map((row) => row.state))].sort();
  return {
    test: true,
    notice: TEST_NOTICE,
    countries: countries(),
    mobileOperators: MOBILE_OPERATORS,
    broadband: BROADBAND,
    electricityStates: states,
    electricity: ELECTRICITY,
    gas: GAS,
    metros: METROS,
  };
}

function assertCategory(category) {
  const code = String(category || '').trim().toUpperCase();
  if (!CATEGORIES.includes(code)) throw AppError.validation('Choose a recharge category');
  return code;
}

function operatorsFor(country) {
  const iso = String(country || '').trim().toUpperCase();
  return MOBILE_OPERATORS[iso] || [];
}

function findOperator(country, code) {
  const operator = operatorsFor(country).find((row) => row.code === String(code || '').toUpperCase());
  if (!operator) throw AppError.validation('Choose an operator available for this country');
  return operator;
}

function assertPhone(country, mobile) {
  const iso = String(country || '').trim().toUpperCase();
  const number = String(mobile || '').trim();
  if (!iso || !getCountries().includes(iso)) throw AppError.validation('Choose a country');
  if (!isValidPhoneNumber(number, iso)) {
    throw AppError.validation('Enter a valid mobile number for the selected country');
  }
  return number;
}

function plansFor(country, operatorCode, lineType) {
  const operator = findOperator(country, operatorCode);
  if (String(lineType || '').toUpperCase() !== 'PREPAID') {
    throw AppError.validation('Plans are available for prepaid lines');
  }
  const plans = (PREPAID_PLANS[operator.code] || [
    { id: `${operator.code}-DEMO-10`, amount: 10, validity: '7 days', data: 'Demo data', calls: 'Demo calls', benefits: 'Demonstration plan' },
  ]).map((plan) => ({ ...plan, currency: country === 'IN' ? 'INR' : 'INR', test: true }));
  return {
    test: true,
    notice: TEST_NOTICE,
    operator,
    plans,
  };
}

function billFor(input) {
  const category = assertCategory(input.category);
  const window = billingWindow();
  if (category === 'MOBILE') {
    assertPhone(input.country, input.mobile);
    const operator = findOperator(input.country, input.operator);
    if (String(input.lineType || '').toUpperCase() !== 'POSTPAID') {
      throw AppError.validation('Bill fetch is for postpaid lines');
    }
    const amount = demoAmount(input.mobile);
    return {
      test: true,
      notice: TEST_NOTICE,
      category,
      provider: operator.name,
      providerCode: operator.code,
      accountMasked: maskAccount(input.mobile),
      amount,
      currency: 'INR',
      billingPeriod: window.period,
      dueDate: window.dueDate,
      status: 'Unpaid test bill',
      details: {
        mobile: maskAccount(input.mobile),
        lineType: 'Postpaid',
        billNumber: `TEST-${demoAmount(operator.code + input.mobile)}`,
      },
    };
  }
  if (category === 'BROADBAND') {
    const provider = BROADBAND.find((row) => row.code === String(input.provider || '').toUpperCase());
    if (!provider) throw AppError.validation('Choose a broadband provider');
    const account = String(input.account || '').trim();
    if (account.length < 6) throw AppError.validation('Enter the registered mobile or account ID');
    const amount = demoAmount(account);
    return {
      test: true,
      notice: TEST_NOTICE,
      category,
      provider: provider.name,
      providerCode: provider.code,
      accountMasked: maskAccount(account),
      amount,
      currency: 'INR',
      billingPeriod: window.period,
      dueDate: window.dueDate,
      status: 'Unpaid test bill',
      details: { account: maskAccount(account) },
    };
  }
  if (category === 'ELECTRICITY') {
    const provider = ELECTRICITY.find((row) => row.code === String(input.provider || '').toUpperCase());
    if (!provider) throw AppError.validation('Choose an electricity provider');
    if (provider.state !== input.state) throw AppError.validation('Choose a provider in the selected state');
    const account = String(input.account || '').trim();
    if (!/^[A-Za-z0-9/-]{6,20}$/.test(account)) throw AppError.validation('Enter a consumer or account number');
    const amount = demoAmount(account);
    return {
      test: true,
      notice: TEST_NOTICE,
      category,
      provider: provider.name,
      providerCode: provider.code,
      accountMasked: maskAccount(account),
      amount,
      currency: 'INR',
      billingPeriod: window.period,
      dueDate: window.dueDate,
      status: 'Unpaid test bill',
      details: {
        consumerNumber: maskAccount(account),
        state: provider.state,
        registeredMobile: input.mobile ? maskAccount(input.mobile) : null,
      },
    };
  }
  if (category === 'GAS') {
    const provider = GAS.find((row) => row.code === String(input.provider || '').toUpperCase());
    if (!provider) throw AppError.validation('Choose a gas provider');
    const account = String(input.account || '').trim();
    if (account.length < 6) throw AppError.validation('Enter the consumer or customer number');
    const amount = demoAmount(`${provider.code}:${account}`);
    return {
      test: true,
      notice: TEST_NOTICE,
      category,
      provider: provider.name,
      providerCode: provider.code,
      accountMasked: maskAccount(account),
      amount,
      currency: 'INR',
      billingPeriod: window.period,
      dueDate: window.dueDate,
      status: 'Unpaid test bill',
      details: { category: provider.category, consumerNumber: maskAccount(account) },
    };
  }
  throw AppError.validation('This category does not use bill fetch');
}

function quoteInput(input) {
  const category = assertCategory(input.category);
  if (category === 'MOBILE' && String(input.lineType || '').toUpperCase() === 'PREPAID') {
    assertPhone(input.country, input.mobile);
    const operator = findOperator(input.country, input.operator);
    const plans = plansFor(input.country, operator.code, 'PREPAID').plans;
    const plan = plans.find((row) => row.id === input.planId);
    if (!plan) throw AppError.validation('Choose a recharge plan');
    return {
      category,
      amount: plan.amount,
      currency: 'INR',
      providerCode: operator.code,
      providerName: operator.name,
      accountMasked: maskAccount(input.mobile),
      summary: { lineType: 'Prepaid', plan, country: String(input.country).toUpperCase(), test: true, notice: TEST_NOTICE },
    };
  }
  if (category === 'METRO') {
    const metro = METROS.find((row) => row.code === String(input.provider || '').toUpperCase());
    if (!metro) throw AppError.validation('Choose a metro system');
    const account = String(input.account || '').trim();
    if (!/^[A-Za-z0-9]{8,20}$/.test(account)) throw AppError.validation('Enter the card or account identifier');
    const amount = Number(input.amount);
    if (!Number.isInteger(amount) || amount < 50 || amount > 10000) {
      throw AppError.validation('Enter a recharge amount between 50 and 10000');
    }
    return {
      category,
      amount,
      currency: 'INR',
      providerCode: metro.code,
      providerName: metro.name,
      accountMasked: maskAccount(account),
      summary: { metro: metro.name, city: metro.city, note: metro.note, test: true, notice: TEST_NOTICE },
    };
  }
  const bill = billFor(input);
  return {
    category,
    amount: bill.amount,
    currency: bill.currency,
    providerCode: bill.providerCode,
    providerName: bill.provider,
    accountMasked: bill.accountMasked,
    summary: { bill, test: true, notice: TEST_NOTICE },
  };
}

async function record(context, operation, stage, payload, status = 'SUCCESS') {
  await writeLifecycleLog({
    requestId: context.requestId,
    journeyId: context.journeyId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'RECHARGE',
    operation,
    businessOperation: operation,
    stage,
    direction: stage.startsWith('SUPPLIER') || stage === 'PAYMENT_CREATED' ? 'SUPPLIER' : 'INBOUND',
    status,
    supplierCode: operation === 'PAYMENT' ? 'APL_MOCK_PAY' : stage.startsWith('SUPPLIER') ? 'APL_MOCK_RECHARGE' : undefined,
    request: stage.includes('REQUEST') ? payload : undefined,
    supplierRequest: stage === 'SUPPLIER_REQUEST' ? payload : undefined,
    result: stage.includes('RESPONSE') || stage === 'OUTBOUND_RESPONSE' ? payload : undefined,
  });
}

async function validateRecharge(input, context) {
  const quote = quoteInput(input);
  const key = String(input.idempotencyKey || '').trim();
  if (key.length < 8) throw AppError.validation('A validation reference is required');
  const existing = await RechargeOrder.findOne({ dsaId: context.dsaId, idempotencyKey: key });
  if (existing && existing.status !== 'VALIDATED') return present(existing.toObject());
  if (existing) {
    existing.category = quote.category;
    existing.amount = quote.amount;
    existing.currency = quote.currency;
    existing.providerCode = quote.providerCode;
    existing.providerName = quote.providerName;
    existing.accountMasked = quote.accountMasked;
    existing.summary = quote.summary;
    existing.expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await existing.save();
    context.journeyId = existing.journeyId;
    return present(existing.toObject());
  }
  const ref = reference();
  let order;
  try {
    order = await RechargeOrder.create({
      reference: ref,
      journeyId: ref,
      dsaId: context.dsaId,
      userId: context.userId || undefined,
      idempotencyKey: key,
      category: quote.category,
      status: 'VALIDATED',
      amount: quote.amount,
      currency: quote.currency,
      providerCode: quote.providerCode,
      providerName: quote.providerName,
      accountMasked: quote.accountMasked,
      summary: quote.summary,
      test: true,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
  } catch (error) {
    if (error && error.code === 11000) {
      const winner = await RechargeOrder.findOne({ dsaId: context.dsaId, idempotencyKey: key }).lean();
      if (winner) return present(winner);
    }
    throw error;
  }
  context.journeyId = order.journeyId;
  await record(context, 'VALIDATE', 'NORMALIZED_REQUEST', { category: quote.category, amount: quote.amount });
  await record(context, 'VALIDATE', 'OUTBOUND_RESPONSE', { reference: order.reference, amount: quote.amount, locked: true, externalHold: false });
  return present(order.toObject());
}

async function payRecharge(input, context) {
  const key = String(input.idempotencyKey || '').trim();
  const order = await RechargeOrder.findOne({ dsaId: context.dsaId, idempotencyKey: key });
  if (!order) throw AppError.validation('Validate the amount before payment');
  if (order.status === 'SUCCESS' || order.status === 'FAILED' || order.status === 'PENDING') {
    return present(order.toObject());
  }
  if (order.expiresAt && order.expiresAt.getTime() < Date.now()) {
    throw AppError.validation('The amount lock expired. Review the details again.');
  }
  const { quotePaymentFee } = require('../../payments/payment-method-fee');
  const method = String(input.paymentMethod || (input.cardLast4 ? 'CARD' : 'UPI')).toUpperCase();
  let quoted;
  try {
    quoted = quotePaymentFee(order.amount, method);
  } catch (error) {
    throw AppError.validation(error.message || 'Unsupported payment method');
  }
  const confirmed = Number(input.amount);
  if (confirmed !== order.amount && confirmed !== quoted.totalAmount) {
    throw AppError.validation('The payment amount does not match the locked amount', [{
      requiredAmount: quoted.totalAmount,
      baseAmount: order.amount,
      feeAmount: quoted.feeAmount,
      providedAmount: confirmed,
      currency: order.currency,
    }]);
  }
  if (input.feeAmount != null && Number(input.feeAmount) !== quoted.feeAmount) {
    throw AppError.validation('Payment fee does not match the selected method', [{
      requiredFee: quoted.feeAmount,
      providedFee: Number(input.feeAmount),
    }]);
  }
  context.journeyId = order.journeyId;
  const last4 = String(input.cardLast4 || '').replace(/\D/g, '');
  if (quoted.method === 'CARD' && !/^\d{4}$/.test(last4)) {
    throw AppError.validation('Enter the last four digits of the mock card');
  }
  const declined = last4 === '0002';
  if (quoted.method === 'WALLET') {
    const CustomerWallet = require('../../customer/models/CustomerWallet');
    const wallet = await CustomerWallet.findOne({
      userId: context.userId,
      dsaId: context.dsaId,
      currency: order.currency,
    });
    if (!wallet || Number(wallet.balance) < quoted.totalAmount) {
      throw AppError.validation('Insufficient wallet balance', [{
        balance: Number(wallet?.balance || 0),
        requiredAmount: quoted.totalAmount,
        currency: order.currency,
      }]);
    }
  }
  await record(context, 'PAYMENT', 'FEE_RESPONSE', {
    method: quoted.method,
    baseAmount: quoted.baseAmount,
    feeAmount: quoted.feeAmount,
    totalAmount: quoted.totalAmount,
    provider: 'APL_MOCK_PAY',
    simulated: true,
  });
  await record(context, 'PAYMENT', 'SUPPLIER_REQUEST', {
    provider: 'APL_MOCK_PAY',
    simulated: true,
    method: quoted.method,
    amount: quoted.totalAmount,
    currency: order.currency,
    last4: last4 || undefined,
  });
  await record(context, 'PAYMENT', 'SUPPLIER_RESPONSE', { approved: !declined, test: true }, declined ? 'FAILED' : 'SUCCESS');
  if (declined) {
    order.status = 'FAILED';
    order.summary = { ...order.summary, payment: { status: 'DECLINED', last4, test: true } };
    await order.save();
    await record(context, 'RECHARGE', 'OUTBOUND_RESPONSE', { reference: order.reference, status: 'FAILED' }, 'FAILED');
    return present(order.toObject());
  }
  await record(context, 'RECHARGE', 'SUPPLIER_REQUEST', {
    adapter: 'mock',
    provider: order.providerName,
    amount: order.amount,
    account: order.accountMasked,
    test: true,
  });
  await record(context, 'RECHARGE', 'SUPPLIER_RESPONSE', { accepted: true, test: true, notice: TEST_NOTICE });
  if (quoted.method === 'WALLET') {
    const CustomerWallet = require('../../customer/models/CustomerWallet');
    const debited = await CustomerWallet.findOneAndUpdate(
      {
        userId: context.userId,
        dsaId: context.dsaId,
        currency: order.currency,
        balance: { $gte: quoted.totalAmount },
      },
      { $inc: { balance: -quoted.totalAmount, totalDebits: quoted.totalAmount } },
      { new: true },
    );
    if (!debited) throw AppError.validation('Insufficient wallet balance');
  }
  order.status = 'SUCCESS';
  order.summary = {
    ...order.summary,
    payment: {
      status: 'APPROVED',
      last4: last4 || undefined,
      method: quoted.method,
      provider: 'APL_MOCK_PAY',
      simulated: true,
      feeAmount: quoted.feeAmount,
      totalAmount: quoted.totalAmount,
      test: true,
    },
    receipt: { reference: order.reference, executedAt: new Date().toISOString(), test: true },
  };
  await order.save();
  await record(context, 'RECHARGE', 'OUTBOUND_RESPONSE', { reference: order.reference, status: 'SUCCESS', test: true });
  return present(order.toObject());
}

async function listRecharges(context) {
  if (!context.userId) throw AppError.unauthorized();
  const rows = await RechargeOrder.find({ dsaId: context.dsaId, userId: context.userId, status: { $ne: 'VALIDATED' } })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();
  return { test: true, items: rows.map(present) };
}

function present(order) {
  return {
    reference: order.reference,
    journeyId: order.journeyId,
    category: order.category,
    status: order.status,
    amount: order.amount,
    currency: order.currency,
    providerCode: order.providerCode,
    providerName: order.providerName,
    accountMasked: order.accountMasked,
    summary: order.summary || {},
    test: true,
    notice: TEST_NOTICE,
    createdAt: order.createdAt,
  };
}

module.exports = {
  catalogue,
  operatorsFor,
  plansFor,
  billFor,
  validateRecharge,
  payRecharge,
  listRecharges,
  TEST_NOTICE,
};
