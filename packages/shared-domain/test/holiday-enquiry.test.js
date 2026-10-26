'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalServiceCode,
  isServiceAlias,
  serviceModeForCode,
  publicServiceLabel,
} = require('../constants/services');
const { validateHolidayEnquiry } = require('../rules/holiday-enquiry');
const { encryptField, decryptField, maskDocument } = require('../security/document-crypto');

describe('holiday enquiry rules', () => {
  it('canonicalizes aliases without renaming the eight service codes', () => {
    assert.equal(canonicalServiceCode('cab'), 'transfer');
    assert.equal(canonicalServiceCode('taxi'), 'transfer');
    assert.equal(canonicalServiceCode('holidays'), 'holiday');
    assert.equal(canonicalServiceCode('insiurance'), 'insurance');
    assert.equal(canonicalServiceCode('visa'), 'visa');
    assert.equal(isServiceAlias('cab'), true);
    assert.equal(isServiceAlias('transfer'), false);
    assert.equal(serviceModeForCode('holiday'), 'ENQUIRY');
    assert.equal(serviceModeForCode('recharge'), 'CONFIGURABLE');
    assert.equal(serviceModeForCode('transfer'), 'API_BOOKING');
    assert.equal(publicServiceLabel('transfer', 'Transfer'), 'Transfer (Cab)');
    assert.equal(publicServiceLabel('holiday', 'Holiday'), 'Holidays');
  });

  it('requires a passport only for an international package', () => {
    const domestic = validateHolidayEnquiry(sample({ documentType: 'AADHAAR', documentNumber: '123456789012' }), {
      isInternational: false,
    });
    assert.equal(domestic.ok, true);

    const missingPassport = validateHolidayEnquiry(sample({ documentType: 'AADHAAR', documentNumber: '123456789012' }), {
      isInternational: true,
    });
    assert.equal(missingPassport.ok, false);

    const passport = validateHolidayEnquiry(
      sample({
        documentType: 'PASSPORT',
        documentNumber: 'Z1234567',
        holderName: 'Amit Sharma',
        expiryDate: '2030-01-01',
        issuingCountry: 'India',
      }),
      { isInternational: true },
    );
    assert.equal(passport.ok, true);
  });

  it('accepts a lead traveller who turns 18 on the departure date', () => {
    const body = sample({ documentType: 'AADHAAR', documentNumber: '123456789012' });
    body.preferredDepartureDate = '2026-10-20';
    body.passengers[0].dateOfBirth = '2008-10-20';
    body.passengers[0].age = 17;
    const result = validateHolidayEnquiry(body, { isInternational: false });
    assert.equal(result.ok, true);
    assert.equal(result.value.passengers[0].age, 18);
  });

  it('rejects a lead traveller who is one day under 18', () => {
    const body = sample({ documentType: 'AADHAAR', documentNumber: '123456789012' });
    body.preferredDepartureDate = '2026-10-20';
    body.passengers[0].dateOfBirth = '2008-10-21';
    const result = validateHolidayEnquiry(body, { isInternational: false });
    assert.equal(result.ok, false);
    assert.equal(
      result.errors.some((error) => error.message === 'The lead traveller must be at least 18 on the departure date'),
      true,
    );
  });

  it('rejects a missing lead date of birth and an invalid travel date', () => {
    const missing = sample({ documentType: 'AADHAAR', documentNumber: '123456789012' });
    delete missing.passengers[0].dateOfBirth;
    const missingResult = validateHolidayEnquiry(missing, { isInternational: false });
    assert.equal(missingResult.ok, false);
    assert.equal(
      missingResult.errors.some((error) => error.field === 'passengers.0.dateOfBirth'),
      true,
    );

    const invalid = sample({ documentType: 'AADHAAR', documentNumber: '123456789012' });
    invalid.preferredDepartureDate = '2020-01-01';
    const invalidResult = validateHolidayEnquiry(invalid, { isInternational: false });
    assert.equal(invalidResult.ok, false);
    assert.equal(invalidResult.errors.some((error) => error.field === 'preferredDepartureDate'), true);
  });

  it('rejects a passenger count that does not match the records', () => {
    const body = sample({ documentType: 'PAN', documentNumber: 'ABCDE1234F' });
    body.totalPassengers = 2;
    const result = validateHolidayEnquiry(body, { isInternational: false });
    assert.equal(result.ok, false);
  });

  it('encrypts document numbers and masks them', () => {
    const stored = encryptField('Z1234567');
    assert.equal(stored.startsWith('enc:v1:'), true);
    assert.equal(stored.includes('Z1234567'), false);
    assert.equal(decryptField(stored), 'Z1234567');
    assert.equal(maskDocument('Z1234567'), '****4567');
  });
});

function sample(document) {
  return {
    preferredDepartureDate: '2030-06-01',
    durationDays: 5,
    adults: 1,
    children: 0,
    totalPassengers: 1,
    contactDetails: { name: 'Priya Mehta', mobile: '9990001111', email: 'rahul@example.test' },
    idempotencyKey: 'idem-1',
    passengers: [
      {
        fullName: 'Amit Sharma',
        dateOfBirth: '1990-01-01',
        nationality: 'Indian',
        document: {
          type: document.documentType,
          number: document.documentNumber,
          holderName: document.holderName,
          expiryDate: document.expiryDate,
          issuingCountry: document.issuingCountry,
        },
      },
    ],
  };
}
