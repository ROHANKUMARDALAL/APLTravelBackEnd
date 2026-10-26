'use strict';

const { AppError } = require('../errors/app-error');

/**
 * Client sends confirmPrice. Server recomputes the required total
 * (base fare/room + selected add-ons) and accepts the booking step only
 * when currency and amount match exactly.
 */
function assertExactPrice(required, confirmPrice) {
  const details = [];
  if (
    !confirmPrice ||
    typeof confirmPrice.amount !== 'number' ||
    !Number.isFinite(confirmPrice.amount)
  ) {
    details.push('confirmPrice.amount is required and must be a number');
  }
  if (!confirmPrice?.currency || typeof confirmPrice.currency !== 'string') {
    details.push('confirmPrice.currency is required');
  }
  if (details.length) {
    throw AppError.validation('confirmPrice is required to book', details);
  }

  const currency = String(confirmPrice.currency).trim().toUpperCase();
  if (currency !== required.currency) {
    throw AppError.validation('Price mismatch', [
      {
        field: 'confirmPrice.currency',
        required: required.currency,
        provided: currency,
      },
    ]);
  }
  if (confirmPrice.amount !== required.amount) {
    throw AppError.validation(
      `Price mismatch. Required amount is ${required.amount} ${required.currency}`,
      [
        {
          field: 'confirmPrice.amount',
          requiredAmount: required.amount,
          providedAmount: confirmPrice.amount,
          currency: required.currency,
        },
      ],
    );
  }
}

function addonIdentity(raw) {
  if (typeof raw === 'string') {
    return { code: raw.trim(), passengerKey: '', segmentKey: '' };
  }
  if (raw && typeof raw === 'object') {
    return {
      code: String(raw.code || '').trim(),
      passengerKey: String(raw.passengerKey || ''),
      segmentKey: String(raw.segmentKey || ''),
    };
  }
  return { code: '', passengerKey: '', segmentKey: '' };
}

function sumSelected(catalog, codes, label) {
  const selected = [];
  const seen = new Set();
  const passengerSeat = new Set();
  for (const raw of codes || []) {
    const identity = addonIdentity(raw);
    if (!identity.code) continue;
    const key = label === 'seat'
      ? `seat:${identity.segmentKey}:${identity.code}`
      : `${label}:${identity.passengerKey}:${identity.segmentKey}:${identity.code}`;
    if (seen.has(key)) {
      throw AppError.validation(
        label === 'seat'
          ? `Seat ${identity.code} is already selected on this flight`
          : `Duplicate ${label} code: ${identity.code}`,
      );
    }
    if (label === 'seat' && identity.passengerKey) {
      const own = `${identity.passengerKey}:${identity.segmentKey}`;
      if (passengerSeat.has(own)) {
        throw AppError.validation('Each passenger can select one seat on a segment');
      }
      passengerSeat.add(own);
    }
    seen.add(key);
    const item = catalog.find((row) => row.code === identity.code);
    if (!item) {
      throw AppError.validation(`Unknown ${label} code: ${identity.code}`, [
        `Allowed: ${catalog.map((row) => row.code).join(', ')}`,
      ]);
    }
    if (item.status === 'OCCUPIED') {
      throw AppError.validation(`Seat ${identity.code} is not available on this segment`);
    }
    selected.push({
      ...item,
      passengerKey: identity.passengerKey || null,
      segmentKey: identity.segmentKey || null,
    });
  }
  const amount = selected.reduce((sum, item) => sum + item.price.amount, 0);
  return { selected, amount };
}

module.exports = { assertExactPrice, sumSelected };
