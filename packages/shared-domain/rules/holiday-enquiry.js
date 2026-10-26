'use strict';

const { DOMESTIC_ID_TYPES } = require('../constants/services');

function clean(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Age in full years on a calendar date. Compares year, month, and day only. */
function ageOnIsoDate(dob, onDate) {
  if (!isIsoDate(dob) || !isIsoDate(onDate)) return null;
  const [year, month, day] = dob.split('-').map(Number);
  const [travelYear, travelMonth, travelDay] = onDate.split('-').map(Number);
  let age = travelYear - year;
  if (travelMonth < month || (travelMonth === month && travelDay < day)) age -= 1;
  return age;
}

/**
 * Validate a holiday enquiry body. International rules come from the stored package,
 * never from a client flag.
 */
function validateHolidayEnquiry(body, { isInternational } = {}) {
  const errors = [];
  const source = body && typeof body === 'object' ? body : {};
  const adults = Number(source.adults);
  const children = Number(source.children || 0);
  const totalPassengers = Number(source.totalPassengers);
  const passengers = Array.isArray(source.passengers) ? source.passengers : [];
  const contact = source.contactDetails || {};

  if (!isIsoDate(source.preferredDepartureDate) || source.preferredDepartureDate < todayIso()) {
    errors.push({ field: 'preferredDepartureDate', message: 'Choose a departure date today or later' });
  }
  const durationDays = Number(source.durationDays);
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    errors.push({ field: 'durationDays', message: 'Travel days must be at least 1' });
  }
  if (!Number.isInteger(adults) || adults < 1) {
    errors.push({ field: 'adults', message: 'At least one adult is required' });
  }
  if (!Number.isInteger(children) || children < 0) {
    errors.push({ field: 'children', message: 'Children cannot be negative' });
  }
  if (!Number.isInteger(totalPassengers) || totalPassengers < 1) {
    errors.push({ field: 'totalPassengers', message: 'Passenger count is required' });
  }
  if (Number.isInteger(adults) && Number.isInteger(children) && adults + children !== totalPassengers) {
    errors.push({ field: 'totalPassengers', message: 'Adults and children must add up to the total passengers' });
  }
  if (passengers.length !== totalPassengers) {
    errors.push({
      field: 'passengers',
      message: 'Passenger records must match the total passenger count',
    });
  }
  if (!passengers.length) {
    errors.push({ field: 'passengers.0', message: 'A lead traveller is required' });
  }

  const contactName = clean(contact.name, 160);
  const mobile = clean(contact.mobile, 20);
  const email = clean(contact.email, 254).toLowerCase();
  if (!contactName) {
    errors.push({ field: 'contactDetails.name', message: 'Contact name is required' });
  }
  if (!/^\+?[0-9]{8,15}$/.test(mobile)) {
    errors.push({ field: 'contactDetails.mobile', message: 'Enter a contact mobile of 8 to 15 digits' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: 'contactDetails.email', message: 'Enter a contact email' });
  }

  const normalizedPassengers = passengers.map((row, index) => {
    const fullName = clean(row?.fullName, 160);
    const dateOfBirth = clean(row?.dateOfBirth, 10);
    const age = row?.age === '' || row?.age === undefined || row?.age === null ? null : Number(row.age);
    const document = row?.document || {};
    const documentType = clean(document.type || row?.documentType, 40).toUpperCase();
    const documentNumber = clean(document.number || row?.documentNumber, 32);
    if (!fullName) errors.push({ field: `passengers.${index}.fullName`, message: 'Passenger name is required' });
    if (isIsoDate(dateOfBirth) && dateOfBirth > todayIso()) {
      errors.push({ field: `passengers.${index}.dateOfBirth`, message: 'Date of birth cannot be in the future' });
    }
    if (index === 0) {
      if (!isIsoDate(dateOfBirth)) {
        errors.push({ field: 'passengers.0.dateOfBirth', message: 'Lead traveller date of birth is required' });
      } else if (isIsoDate(source.preferredDepartureDate) && ageOnIsoDate(dateOfBirth, source.preferredDepartureDate) < 18) {
        errors.push({
          field: 'passengers.0.dateOfBirth',
          message: 'The lead traveller must be at least 18 on the departure date',
        });
      }
    }
    if (!dateOfBirth && (age === null || Number.isNaN(age))) {
      errors.push({ field: `passengers.${index}.dateOfBirth`, message: 'Date of birth or age is required' });
    }
    if (dateOfBirth && !isIsoDate(dateOfBirth)) {
      errors.push({ field: `passengers.${index}.dateOfBirth`, message: 'Date of birth must be YYYY-MM-DD' });
    }
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
      errors.push({ field: `passengers.${index}.age`, message: 'Age must be between 0 and 120' });
    }
    const nationality = clean(row?.nationality || document.nationality, 80);
    if (!nationality) {
      errors.push({ field: `passengers.${index}.nationality`, message: 'Nationality is required' });
    }
    if (isInternational) {
      if (documentType !== 'PASSPORT') {
        errors.push({ field: `passengers.${index}.document.type`, message: 'A passport is required for an international holiday' });
      }
      if (!/^[A-Za-z0-9]{6,16}$/.test(documentNumber)) {
        errors.push({ field: `passengers.${index}.document.number`, message: 'Passport number is required' });
      }
      const holderName = clean(document.holderName || fullName, 160);
      const expiryDate = clean(document.expiryDate, 10);
      const issuingCountry = clean(document.issuingCountry, 80);
      const passportDob = clean(document.dateOfBirth || dateOfBirth, 10);
      if (!holderName) errors.push({ field: `passengers.${index}.document.holderName`, message: 'Passport holder name is required' });
      if (!isIsoDate(passportDob)) errors.push({ field: `passengers.${index}.document.dateOfBirth`, message: 'Passport date of birth is required' });
      if (!isIsoDate(expiryDate) || expiryDate <= todayIso()) {
        errors.push({ field: `passengers.${index}.document.expiryDate`, message: 'Passport expiry must be in the future' });
      }
      if (!issuingCountry) {
        errors.push({ field: `passengers.${index}.document.issuingCountry`, message: 'Passport issuing country is required' });
      }
      return {
        fullName,
        dateOfBirth: passportDob,
        age: isIsoDate(passportDob) && isIsoDate(source.preferredDepartureDate)
          ? ageOnIsoDate(passportDob, source.preferredDepartureDate)
          : undefined,
        gender: clean(row?.gender, 20),
        nationality,
        document: {
          type: 'PASSPORT',
          number: documentNumber,
          holderName,
          nationality,
          dateOfBirth: passportDob,
          expiryDate,
          issuingCountry,
        },
      };
    }
    if (!DOMESTIC_ID_TYPES.includes(documentType)) {
      errors.push({
        field: `passengers.${index}.document.type`,
        message: 'Choose Aadhaar, PAN, driving licence, voter ID, or passport',
      });
    }
    if (!/^[A-Za-z0-9]{4,32}$/.test(documentNumber)) {
      errors.push({ field: `passengers.${index}.document.number`, message: 'Identity document number is required' });
    }
    return {
      fullName,
      dateOfBirth,
      age: isIsoDate(dateOfBirth) && isIsoDate(source.preferredDepartureDate)
        ? ageOnIsoDate(dateOfBirth, source.preferredDepartureDate)
        : undefined,
      gender: clean(row?.gender, 20),
      nationality,
      document: {
        type: documentType,
        number: documentNumber,
        holderName: clean(document.holderName || fullName, 160),
        nationality,
        dateOfBirth,
        expiryDate: '',
        issuingCountry: '',
      },
    };
  });

  return {
    ok: errors.length === 0,
    errors,
    value: {
      preferredDepartureDate: clean(source.preferredDepartureDate, 10),
      durationDays: Number.isInteger(durationDays) ? durationDays : 0,
      adults: Number.isInteger(adults) ? adults : 0,
      children: Number.isInteger(children) ? children : 0,
      totalPassengers: Number.isInteger(totalPassengers) ? totalPassengers : 0,
      passengers: normalizedPassengers,
      contactDetails: { name: contactName, mobile, email },
      specialRequirements: clean(source.specialRequirements, 4000),
      idempotencyKey: clean(source.idempotencyKey, 80),
    },
  };
}

function validateServiceEnquiry(body) {
  const errors = [];
  const source = body && typeof body === 'object' ? body : {};
  const contact = source.contactDetails || {};
  const mobile = clean(contact.mobile, 20);
  const email = clean(contact.email, 254).toLowerCase();
  if (!isIsoDate(source.preferredDepartureDate) || source.preferredDepartureDate < todayIso()) {
    errors.push({ field: 'preferredDepartureDate', message: 'Choose a date today or later' });
  }
  if (!/^\+?[0-9]{8,15}$/.test(mobile)) {
    errors.push({ field: 'contactDetails.mobile', message: 'Enter a contact mobile of 8 to 15 digits' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: 'contactDetails.email', message: 'Enter a contact email' });
  }
  const service = clean(source.serviceCode, 40).toLowerCase();
  const contactName = clean(contact.name || source.contactName, 120);
  let adults = 0;
  let specialRequirements = clean(source.specialRequirements, 2000);
  if (service === 'transfer') {
    const pickup = clean(source.pickup, 160);
    const dropoff = clean(source.dropoff || source.drop, 160);
    const pickupTime = clean(source.pickupTime, 8);
    const vehicle = clean(source.vehiclePreference, 80);
    const passengers = Number(source.passengers);
    if (!pickup) errors.push({ field: 'pickup', message: 'Enter a pickup location' });
    if (!dropoff) errors.push({ field: 'dropoff', message: 'Enter a drop location' });
    if (!/^\d{2}:\d{2}$/.test(pickupTime)) errors.push({ field: 'pickupTime', message: 'Enter a pickup time' });
    if (!vehicle) errors.push({ field: 'vehiclePreference', message: 'Choose a vehicle preference' });
    if (!Number.isInteger(passengers) || passengers < 1 || passengers > 12) {
      errors.push({ field: 'passengers', message: 'Enter 1 to 12 passengers' });
    }
    if (!contactName) errors.push({ field: 'contactDetails.name', message: 'Enter a contact name' });
    adults = Number.isInteger(passengers) ? passengers : 0;
    specialRequirements = [
      pickup ? `Pickup: ${pickup}` : '',
      dropoff ? `Drop: ${dropoff}` : '',
      pickupTime ? `Time: ${pickupTime}` : '',
      vehicle ? `Vehicle: ${vehicle}` : '',
      adults ? `Passengers: ${adults}` : '',
      specialRequirements ? `Notes: ${specialRequirements}` : '',
    ].filter(Boolean).join('\n').slice(0, 4000);
  }
  return {
    ok: errors.length === 0,
    errors,
    value: {
      preferredDepartureDate: clean(source.preferredDepartureDate, 10),
      durationDays: 0,
      adults,
      children: 0,
      totalPassengers: adults,
      passengers: [],
      contactDetails: { name: contactName, mobile, email },
      specialRequirements,
      idempotencyKey: clean(source.idempotencyKey, 80),
    },
  };
}

module.exports = {
  validateHolidayEnquiry,
  validateServiceEnquiry,
  ageOnIsoDate,
};
