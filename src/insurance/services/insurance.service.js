'use strict';

const crypto = require('crypto');
const { AppError } = require('../../common/errors/app-error');
const { formatAplSearchId } = require('../../common/utils/apl-ids');
const { createPricingContext, calculatePrice } = require('../../pricing/services/pricing-engine.service');
const { logSupplierOutcomes } = require('../../common/services/service-log.service');
const { writeLifecycleLog, logPublicSearchResult } = require('../../common/services/lifecycle-log.service');
const { createCheckoutSession, confirmBookingFromCheckout } = require('../../common/services/checkout-booking.service');
const { assertExactPrice } = require('../../common/utils/price-confirm');
const { MOCK_INSURANCE_PLANS } = require('../data/mock-plans');
const Search = require('../../common/database/models/Search');

const DISCLAIMER = 'Mock comparison only. These plans do not provide real coverage and no insurance policy is issued.';

function ageOn(dob, onDate) {
  const birth = new Date(dob);
  const on = new Date(onDate);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(on.getTime())) return null;
  let age = on.getUTCFullYear() - birth.getUTCFullYear();
  const month = on.getUTCMonth() - birth.getUTCMonth();
  if (month < 0 || (month === 0 && on.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

function tripDays(departureDate, returnDate) {
  const start = new Date(departureDate);
  const end = new Date(returnDate);
  const days = Math.round((end - start) / 86400000) + 1;
  return Number.isFinite(days) ? days : 0;
}

function travellerAges(travellers, departureDate) {
  return (travellers || []).map((person, index) => {
    const age = person.age != null && person.age !== ''
      ? Number(person.age)
      : ageOn(person.dob || person.dateOfBirth, departureDate);
    return {
      type: String(person.type || (age != null && age < 18 ? 'CHILD' : 'ADULT')).toUpperCase(),
      age: Number.isInteger(age) ? age : null,
      index,
    };
  });
}

function selectPlans(dto) {
  const ages = travellerAges(dto.travellers, dto.departureDate);
  const days = tripDays(dto.departureDate, dto.returnDate);
  const tripType = String(dto.tripType || 'SINGLE').toUpperCase();
  return MOCK_INSURANCE_PLANS.filter((plan) => {
    if (plan.tripTypes && !plan.tripTypes.includes(tripType) && tripType !== 'ANNUAL') return false;
    if (days > plan.maxDays) return false;
    return ages.every((person) => person.age != null && person.age >= plan.minAge && person.age <= plan.maxAge);
  }).map((plan) => ({ ...plan, mock: true }));
}

function pricePlan(plan, pricingContext) {
  const priced = calculatePrice({
    supplierPrice: plan.premium,
    supplierCode: 'MOCK_INSURE',
    context: pricingContext || {
      rules: [],
      serviceCode: 'insurance',
      dsaId: null,
      at: new Date(),
      pricingVersion: '12.0',
    },
    includeInternal: false,
  });
  return {
    id: plan.id,
    provider: plan.provider,
    name: plan.name,
    premium: priced.customerPrice,
    coverageAmount: plan.coverageAmount,
    medicalCoverage: plan.medicalCoverage,
    baggageProtection: plan.baggageProtection,
    tripProtection: plan.tripProtection,
    exclusions: plan.exclusions,
    benefits: plan.benefits,
    minAge: plan.minAge,
    maxAge: plan.maxAge,
    maxDays: plan.maxDays,
    emergencyAssistance: plan.emergencyAssistance || undefined,
    tripCancellation: plan.tripCancellation || undefined,
    policyConditions: plan.policyConditions || [],
    requiresGender: Boolean(plan.requiresGender),
    passportRequired: Boolean(plan.passportRequired),
    mock: true,
    purchaseEnabled: false,
  };
}

function validateSearch(body) {
  const data = body || {};
  const details = [];
  const destination = String(data.destination || data.country || '').trim();
  if (destination.length < 2) details.push('destination is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.departureDate || ''))) details.push('departureDate must be YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.returnDate || ''))) details.push('returnDate must be YYYY-MM-DD');
  if (data.departureDate && data.returnDate && data.returnDate < data.departureDate) {
    details.push('returnDate must be on or after departureDate');
  }
  const travellers = Array.isArray(data.travellers) ? data.travellers : [];
  if (!travellers.length) details.push('at least one traveller is required');
  const parsed = travellerAges(travellers, data.departureDate);
  if (parsed.some((person) => person.age == null || person.age < 0 || person.age > 120)) {
    details.push('each traveller needs an age or date of birth');
  }
  if (details.length) throw AppError.validation('Invalid insurance search', details);
  return {
    destination,
    travellers: parsed,
    departureDate: data.departureDate,
    returnDate: data.returnDate,
    tripType: String(data.tripType || 'SINGLE').toUpperCase(),
  };
}

async function searchInsurance(dto, context = {}) {
  const searchId = formatAplSearchId(crypto.randomBytes(4).toString('hex').toUpperCase());
  const criteria = validateSearch(dto);
  await writeLifecycleLog({
    stage: 'NORMALIZED_REQUEST',
    direction: 'INBOUND',
    requestId: context.requestId,
    journeyId: searchId,
    businessOperation: 'SEARCH',
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'INSURANCE',
    operation: 'searchInsurance',
    searchId,
    status: 'SUCCESS',
    request: criteria,
  });

  const matched = selectPlans(criteria);
  const supplierRequest = { environment: 'TEST', mock: true, criteria };
  const rawPlans = matched.map((plan) => ({
    id: plan.id,
    provider: plan.provider,
    name: plan.name,
    premium: plan.premium,
    mock: true,
  }));
  await logSupplierOutcomes({
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'INSURANCE',
    operation: 'searchInsurance',
    searchId,
    journeyId: searchId,
    businessOperation: 'SEARCH',
    userRequest: criteria,
    settled: [{
      adapter: { code: 'MOCK_INSURE' },
      outcome: {
        status: 'SUCCESS',
        durationMs: 1,
        supplierRequest,
        rawPayload: { mock: true, supplier: 'MOCK_INSURE', plans: rawPlans },
      },
    }],
  });

  const pricingContext = await createPricingContext({
    dsaId: context.dsaId || null,
    serviceCode: 'insurance',
  });
  const plans = matched.map((plan) => pricePlan(plan, pricingContext));
  const payload = {
    searchId,
    status: 'COMPLETED',
    destination: criteria.destination,
    departureDate: criteria.departureDate,
    returnDate: criteria.returnDate,
    tripType: criteria.tripType,
    travellers: criteria.travellers,
    plans,
    purchaseEnabled: false,
    disclaimer: DISCLAIMER,
  };
  await logPublicSearchResult({
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'INSURANCE',
    searchId,
    journeyId: searchId,
    businessOperation: 'SEARCH',
    payload,
  });
  await Search.create({
    aplSearchId: searchId,
    journeyId: searchId,
    type: 'INSURANCE',
    status: 'COMPLETED',
    dsaId: context.dsaId || undefined,
    userId: context.userId || undefined,
    requestId: context.requestId || undefined,
    request: criteria,
    results: {
      searchId,
      plans: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        provider: plan.provider,
        premium: plan.premium,
      })),
    },
    resultCount: plans.length,
    supplierResults: [{
      supplierCode: 'MOCK_INSURE',
      status: 'SUCCESS',
      durationMs: 1,
      rawResultCount: plans.length,
    }],
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
  return payload;
}

async function getInsurancePlan(body, context = {}) {
  const planId = String(body?.planId || body?.id || '').trim();
  const plan = MOCK_INSURANCE_PLANS.find((row) => row.id === planId);
  if (!plan) throw AppError.notFound('Insurance plan not found');
  const searchId = String(body?.searchId || '').trim() || `plan:${planId}`;
  const request = { planId, searchId };
  await writeLifecycleLog({
    stage: 'NORMALIZED_REQUEST',
    direction: 'INBOUND',
    requestId: context.requestId,
    journeyId: searchId,
    businessOperation: 'DETAILS',
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'INSURANCE',
    operation: 'insurancePlanDetails',
    searchId,
    status: 'SUCCESS',
    request,
  });
  await logSupplierOutcomes({
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'INSURANCE',
    operation: 'insurancePlanDetails',
    searchId,
    journeyId: searchId,
    businessOperation: 'DETAILS',
    userRequest: request,
    settled: [{
      adapter: { code: 'MOCK_INSURE' },
      outcome: {
        status: 'SUCCESS',
        durationMs: 1,
        supplierRequest: { environment: 'TEST', mock: true, planId },
        rawPayload: { mock: true, supplier: 'MOCK_INSURE', plan },
      },
    }],
  });
  const pricingContext = await createPricingContext({
    dsaId: context.dsaId || null,
    serviceCode: 'insurance',
  });
  const details = {
    ...pricePlan(plan, pricingContext),
    searchId,
    purchaseEnabled: false,
    disclaimer: DISCLAIMER,
    comparison: MOCK_INSURANCE_PLANS.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      premium: row.premium,
      coverageAmount: row.coverageAmount,
      selected: row.id === plan.id,
    })),
  };
  await logPublicSearchResult({
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'INSURANCE',
    searchId,
    journeyId: searchId,
    businessOperation: 'DETAILS',
    payload: details,
  });
  return details;
}

function ageFromDob(dob, onDate) {
  return ageOn(dob, onDate || new Date().toISOString().slice(0, 10));
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validateParty(person, label, details, { requireAdult = false } = {}) {
  if (!person || !String(person.firstName || '').trim() || !String(person.lastName || '').trim()) {
    details.push(`${label} full name is required`);
  }
  const age = person?.age != null && person.age !== ''
    ? Number(person.age)
    : ageFromDob(person?.dob || person?.dateOfBirth);
  if (!Number.isInteger(age) || age < 0 || age > 120) details.push(`${label} needs a valid date of birth or age`);
  if (requireAdult && Number.isInteger(age) && age < 18) details.push(`${label} must be 18 or older`);
  if (digits(person?.mobile || person?.phone).length < 8) details.push(`${label} mobile number is required`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(person?.email || '').trim())) {
    details.push(`${label} email is required`);
  }
  if (!String(person?.address || '').trim()) details.push(`${label} address is required`);
  return age;
}

function validateTravellers(body, plan = null) {
  const details = [];
  const travellers = Array.isArray(body?.travellers) ? body.travellers : null;
  if (!travellers?.length) details.push('travellers must be a list');
  const same = Boolean(body?.sameBeneficiary);
  const shared = body?.sharedBeneficiary || travellers?.[0]?.beneficiary;
  const normalized = (travellers || []).map((person, index) => {
    const label = `Traveller ${index + 1}`;
    const age = validateParty(person, label, details);
    if (!String(person?.nationality || '').trim()) details.push(`${label} nationality is required`);
    if (plan?.requiresGender && !String(person?.gender || '').trim()) details.push(`${label} gender is required`);
    if (plan?.passportRequired && !String(person?.passportNumber || '').trim()) {
      details.push(`${label} passport number is required`);
    }
    const minor = Number.isInteger(age) && age < 18;
    const beneficiary = same ? shared : person.beneficiary;
    if (!String(beneficiary?.relationship || '').trim()) details.push(`${label} beneficiary relationship is required`);
    validateParty(beneficiary, `${label} beneficiary`, details, { requireAdult: minor });
    return {
      type: minor ? 'CHILD' : 'ADULT',
      firstName: String(person.firstName || '').trim(),
      lastName: String(person.lastName || '').trim(),
      dateOfBirth: person.dob || person.dateOfBirth || null,
      age,
      gender: person.gender || null,
      email: person.email || null,
      phone: person.mobile || person.phone || null,
      address: person.address || null,
      nationality: person.nationality || null,
      passportNumber: person.passportNumber || null,
      beneficiary: beneficiary ? {
        firstName: String(beneficiary.firstName || '').trim(),
        lastName: String(beneficiary.lastName || '').trim(),
        relationship: beneficiary.relationship || null,
        dateOfBirth: beneficiary.dob || beneficiary.dateOfBirth || null,
        age: beneficiary.age != null && beneficiary.age !== ''
          ? Number(beneficiary.age)
          : ageFromDob(beneficiary.dob || beneficiary.dateOfBirth),
        phone: beneficiary.mobile || beneficiary.phone || null,
        email: beneficiary.email || null,
        address: beneficiary.address || null,
      } : null,
    };
  });
  if (details.length) throw AppError.validation('Invalid traveller details', details);
  return { travellers: normalized, sameBeneficiary: same, travellerCount: normalized.length };
}

async function validateInsuranceTravellers(body, context = {}) {
  const searchId = String(body?.searchId || '').trim();
  const checked = validateTravellers(body);
  await writeLifecycleLog({
    stage: 'NORMALIZED_REQUEST',
    direction: 'INBOUND',
    requestId: context.requestId,
    journeyId: searchId || undefined,
    businessOperation: 'VALIDATE',
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'INSURANCE',
    operation: 'validateTravellers',
    searchId: searchId || undefined,
    status: 'SUCCESS',
    request: {
      searchId: searchId || null,
      travellerCount: checked.travellerCount,
      sameBeneficiary: checked.sameBeneficiary,
      ages: checked.travellers.map((person) => person.age),
    },
  });
  return { ...checked, searchId, purchaseEnabled: false, disclaimer: DISCLAIMER };
}

async function checkoutInsurance(body, context = {}) {
  const plan = MOCK_INSURANCE_PLANS.find((row) => row.id === String(body?.planId || '').trim());
  if (!plan) throw AppError.notFound('Insurance plan not found');
  const checked = validateTravellers(body, plan);
  const pricingContext = await createPricingContext({
    dsaId: context.dsaId || context.tenant?.dsaId || null,
    serviceCode: 'insurance',
  });
  const priced = pricePlan(plan, pricingContext);
  const quote = { amount: priced.premium.amount, currency: priced.premium.currency };
  assertExactPrice(quote, body.confirmPrice);
  const searchId = String(body.searchId || '').trim() || `plan:${plan.id}`;
  return createCheckoutSession({
    productType: 'INSURANCE',
    searchId,
    journeyId: searchId,
    aplOfferId: plan.id,
    aplEntityId: plan.id,
    dsaId: context.tenant?.dsaId || context.dsaId,
    requestId: context.requestId,
    userId: context.userId,
    contact: {
      email: body.contact?.email || checked.travellers[0]?.email,
      phone: body.contact?.phone || checked.travellers[0]?.phone,
    },
    travellers: checked.travellers,
    pricing: { amount: quote.amount, currency: quote.currency, baseAmount: quote.amount, addonsAmount: 0 },
    commercialSnapshot: { totalAmount: quote.amount, currency: quote.currency, demo: true },
    offerSnapshot: {
      supplier: 'MOCK_INSURE',
      planId: plan.id,
      planName: plan.name,
      provider: plan.provider,
      destination: body.destination || null,
      departureDate: body.departureDate || null,
      returnDate: body.returnDate || null,
      travellerCount: checked.travellerCount,
      premium: priced.premium,
      coverageAmount: plan.coverageAmount,
      demo: true,
      purchaseEnabled: false,
    },
  });
}

async function bookInsurance(body, user, context = {}) {
  return confirmBookingFromCheckout({
    checkoutToken: body.checkoutToken,
    payment: body.payment,
    confirmPrice: body.confirmPrice,
    user,
    tenant: context.tenant,
    requestId: context.requestId,
    idempotencyKey: body.idempotencyKey,
  });
}

module.exports = {
  selectPlans,
  validateSearch,
  validateTravellers,
  searchInsurance,
  getInsurancePlan,
  validateInsuranceTravellers,
  checkoutInsurance,
  bookInsurance,
  DISCLAIMER,
};
