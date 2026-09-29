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

function sumSelected(catalog, codes, label) {
  const selected = [];
  const seen = new Set();
  for (const raw of codes) {
    const code = String(raw).trim();
    if (!code) continue;
    if (seen.has(code)) {
      throw AppError.validation(`Duplicate ${label} code: ${code}`);
    }
    seen.add(code);
    const item = catalog.find((row) => row.code === code);
    if (!item) {
      throw AppError.validation(`Unknown ${label} code: ${code}`, [
        `Allowed: ${catalog.map((row) => row.code).join(', ')}`,
      ]);
    }
    selected.push(item);
  }
  const amount = selected.reduce((sum, item) => sum + item.price.amount, 0);
  return { selected, amount };
}

module.exports = { assertExactPrice, sumSelected };
