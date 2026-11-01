'use strict';

const crypto = require('crypto');
const { getCountries, getCountryCallingCode, isValidPhoneNumber } = require('libphonenumber-js');
const { AppError } = require('../../common/errors/app-error');
const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');
const RechargeOrder = require('../models/RechargeOrder');
const { projectRechargePayment, refundRechargeOrder } = require('./recharge-ledger');
const { listDemoPlans, findDemoPlan } = require('../demo-plans');
const { CIRCLES, circlesFor, findCircle } = require('../demo-circles');
const {
  MOBILE_OPERATORS,
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
    circles: CIRCLES,
  };
}

function assertCategory(category) {
  const code = String(category || '').trim().toUpperCase();
  if (!CATEGORIES.includes(code)) throw AppError.validation('Choose a recharge category');
  return code;
}

function operatorsFor(country, lineType) {
  const iso = String(country || '').trim().toUpperCase();
  const type = String(lineType || '').trim().toUpperCase();
  const rows = MOBILE_OPERATORS[iso] || [];
  if (!type) return rows;
  return rows.filter((row) => !row.lineTypes || row.lineTypes.includes(type));
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

function plansFor(country, operatorCode, lineType, circle) {
  const operator = findOperator(country, operatorCode);
  const type = String(lineType || '').toUpperCase();
  if (operator.lineTypes && !operator.lineTypes.includes(type)) {
    throw AppError.validation('This operator is not available for the selected recharge type');
  }
  const region = resolveCircle(country, operator.code, circle);
  const plans = listDemoPlans({ country, operatorCode: operator.code, lineType: type, circle: region?.code });
  return {
    test: true,
    live: false,
    notice: plans[0]?.notice || TEST_NOTICE,
    operator,
    circle: region,
    plans,
  };
}

function resolveCircle(country, operatorCode, circle) {
  const configured = circlesFor(country, operatorCode);
  if (!configured.length) {
    if (circle) throw AppError.validation('No demonstration circle is configured for this operator');
    return null;
  }
  const region = findCircle(country, operatorCode, circle);
  if (!region) throw AppError.validation('Choose a region or circle available for this operator');
  return region;
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
  if (category === 'MOBILE') {
    const lineType = String(input.lineType || '').toUpperCase();
    assertPhone(input.country, input.mobile);
    const operator = findOperator(input.country, input.operator);
    const region = resolveCircle(input.country, operator.code, input.circle);
    const plan = findDemoPlan({
      country: input.country,
      operatorCode: operator.code,
      lineType,
      planId: input.planId,
      circle: region?.code,
    });
    if (!plan) throw AppError.validation('Choose a recharge plan');
    if (input.amount != null && input.amount !== '' && Number(input.amount) !== plan.amount) {
      throw AppError.validation('The selected plan amount does not match');
    }
    return {
      category,
      amount: plan.amount,
      currency: plan.currency,
      providerCode: operator.code,
      providerName: operator.name,
      accountMasked: maskAccount(input.mobile),
      summary: {
        lineType: lineType === 'POSTPAID' ? 'Postpaid' : 'Prepaid',
        plan,
        country: String(input.country).toUpperCase(),
        circle: region,
        test: true,
        notice: plan.notice,
      },
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
  let order = await RechargeOrder.findOne({ dsaId: context.dsaId, idempotencyKey: key });
  if (!order) throw AppError.validation('Validate the amount before payment');
  if (order.status === 'SUCCESS' || order.status === 'FAILED' || order.status === 'REFUNDED') {
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
  if (order.status === 'VALIDATED' && quoted.method === 'WALLET') {
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
  if (order.status === 'VALIDATED') {
    const claimed = await RechargeOrder.findOneAndUpdate(
      { _id: order._id, status: 'VALIDATED' },
      { $set: { status: 'PENDING' } },
      { new: true },
    );
    if (!claimed) {
      const fresh = await RechargeOrder.findById(order._id);
      if (!fresh) throw AppError.validation('Validate the amount before payment');
      if (fresh.status === 'SUCCESS' || fresh.status === 'FAILED' || fresh.status === 'REFUNDED') {
        return present(fresh.toObject());
      }
      order = fresh;
    } else {
      order = claimed;
    }
  }
  const token = crypto.randomBytes(8).toString('hex');
  const locked = await RechargeOrder.findOneAndUpdate(
    {
      _id: order._id,
      status: 'PENDING',
      $or: [{ 'summary.lock': { $exists: false } }, { 'summary.lock': null }, { 'summary.lock': '' }],
    },
    { $set: { 'summary.lock': token } },
    { new: true },
  );
  if (!locked) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const fresh = await RechargeOrder.findById(order._id);
      if (fresh && (fresh.status === 'SUCCESS' || fresh.status === 'FAILED' || fresh.status === 'REFUNDED')) {
        return present(fresh.toObject());
      }
    }
    throw AppError.validation('This recharge payment is already processing');
  }
  order = locked;
  context.journeyId = order.journeyId;
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
  const localDemoPlan = order.summary?.plan?.demo === true;
  if (!declined && !localDemoPlan) {
    await record(context, 'RECHARGE', 'SUPPLIER_REQUEST', {
      adapter: 'mock',
      provider: order.providerName,
      amount: order.amount,
      account: order.accountMasked,
      test: true,
    });
    await record(context, 'RECHARGE', 'SUPPLIER_RESPONSE', { accepted: true, test: true, notice: TEST_NOTICE });
  }
  try {
    const saved = await projectRechargePayment({
      order,
      context,
      quoted: { ...quoted, last4: last4 || undefined },
      outcome: declined ? 'FAILED' : 'SUCCESS',
    });
    await record(
      context,
      'RECHARGE',
      'OUTBOUND_RESPONSE',
      { reference: saved.reference, status: saved.status, bookingReference: saved.summary?.bookingReference, test: true },
      declined ? 'FAILED' : 'SUCCESS',
    );
    return present(saved.toObject());
  } catch (error) {
    await RechargeOrder.updateOne(
      { _id: order._id, status: 'PENDING', 'summary.lock': token },
      { $unset: { 'summary.lock': '' } },
    );
    throw error;
  }
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
  const summary = { ...(order.summary || {}) };
  delete summary.lock;
  return {
    reference: order.reference,
    journeyId: order.journeyId,
    dsaId: order.dsaId ? String(order.dsaId) : null,
    dsaCode: summary.dsaCode || '',
    dsaName: summary.dsaName || '',
    category: order.category,
    status: order.status,
    amount: order.amount,
    currency: order.currency,
    providerCode: order.providerCode,
    providerName: order.providerName,
    accountMasked: order.accountMasked,
    bookingReference: summary.bookingReference || null,
    paymentReference: summary.payment?.paymentRef || summary.receipt?.paymentReference || null,
    summary,
    test: true,
    fulfillment: summary.receipt?.fulfillment || 'DEMO / MOCK RECHARGE',
    notice: TEST_NOTICE,
    createdAt: order.createdAt,
  };
}

async function refundRecharge(reference, context) {
  if (!context.userId) throw AppError.unauthorized();
  const order = await RechargeOrder.findOne({
    reference: String(reference || ''),
    dsaId: context.dsaId,
    userId: context.userId,
  });
  if (!order) throw AppError.validation('Recharge order not found');
  const saved = await refundRechargeOrder(order, context);
  return present(saved.toObject());
}

module.exports = {
  catalogue,
  operatorsFor,
  plansFor,
  billFor,
  validateRecharge,
  payRecharge,
  refundRecharge,
  listRecharges,
  TEST_NOTICE,
};
