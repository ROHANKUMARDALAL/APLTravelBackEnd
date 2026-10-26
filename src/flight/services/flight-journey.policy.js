'use strict';

const crypto = require('crypto');
const { AppError } = require('../../common/errors/app-error');

const BLOCK_TTL_MS = Number(process.env.FLIGHT_BLOCK_TTL_MS || 10 * 60 * 1000);

function newJourneyId() {
  return `APL-JRN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function newBlockRef() {
  return `APL-BLK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Attach an offer to a search journey.
 * The first selection reuses the search journey.
 * A different offer gets its own journey so two bookings are not merged.
 * A client-supplied journey id is accepted only when it already matches.
 */
function selectJourneyForOffer(journeys, searchJourneyId, offer, clientJourneyId) {
  const list = Array.isArray(journeys) ? journeys.map((row) => ({ ...row })) : [];
  const fareId = offer.aplFareId;
  const flightId = offer.aplFlightId;
  const existing = list.find(
    (row) => row.aplFareId === fareId && row.aplFlightId === flightId,
  );
  if (existing) {
    const hintIsSearch = clientJourneyId === searchJourneyId || clientJourneyId === existing.parentJourneyId;
    if (clientJourneyId && clientJourneyId !== existing.journeyId && !hintIsSearch) {
      throw AppError.validation('Journey does not match the selected offer');
    }
    if (existing.supplier && offer.supplier && existing.supplier !== offer.supplier) {
      throw AppError.validation('Selected supplier does not match the stored offer');
    }
    return { journeys: list, journey: existing, created: false };
  }

  const hinted = clientJourneyId ? list.find((row) => row.journeyId === clientJourneyId) : null;
  if (clientJourneyId && !hinted) {
    throw AppError.validation('Journey does not match the selected offer');
  }
  if (hinted && !hinted.aplFareId) {
    hinted.aplFareId = fareId;
    hinted.aplFlightId = flightId;
    hinted.supplier = offer.supplier;
    hinted.role = 'BOOKING';
    return { journeys: list, journey: hinted, created: false };
  }
  if (hinted && hinted.aplFareId && hinted.aplFareId !== fareId && clientJourneyId !== searchJourneyId) {
    throw AppError.validation('Journey does not match the selected offer');
  }

  const open = list.find((row) => row.journeyId === searchJourneyId && !row.aplFareId);
  if (open) {
    open.aplFareId = fareId;
    open.aplFlightId = flightId;
    open.supplier = offer.supplier;
    open.role = 'BOOKING';
    return { journeys: list, journey: open, created: false };
  }

  const journey = {
    journeyId: newJourneyId(),
    parentJourneyId: searchJourneyId || null,
    role: 'BOOKING',
    aplFareId: fareId,
    aplFlightId: flightId,
    supplier: offer.supplier,
  };
  list.push(journey);
  return { journeys: list, journey, created: true };
}

function assertSameSupplier(outboundSupplier, returnSupplier) {
  if (!returnSupplier || !outboundSupplier) return;
  if (String(outboundSupplier).toUpperCase() !== String(returnSupplier).toUpperCase()) {
    throw AppError.validation(
      'This round trip uses two suppliers. A single block is refused. Book each supplier itinerary on its own.',
    );
  }
}

function assertFareConfirmation(journey, offer = {}, now = Date.now()) {
  const confirmation = offer.asReturn ? journey?.returnFareConfirmation : journey?.fareConfirmation;
  if (!confirmation) {
    throw AppError.validation('Confirm the selected fare before continuing.');
  }
  if (confirmation.status === 'PRICE_CHANGED') {
    throw AppError.validation('The fare changed. Accept the updated fare before continuing.');
  }
  if (confirmation.status !== 'CONFIRMED') {
    throw AppError.validation('Confirm the selected fare before continuing.');
  }
  if (offer.aplFareId && confirmation.aplFareId && confirmation.aplFareId !== offer.aplFareId) {
    throw AppError.validation('The confirmed fare does not match the selected offer.');
  }
  if (offer.supplier && confirmation.supplier && String(confirmation.supplier).toUpperCase() !== String(offer.supplier).toUpperCase()) {
    throw AppError.validation('The confirmed supplier does not match the selected offer.');
  }
  if (!confirmation.quoteId) {
    throw AppError.validation('The fare confirmation is missing a supplier quote reference.');
  }
  if (confirmation.expiresAt && new Date(confirmation.expiresAt).getTime() <= now) {
    throw AppError.validation('The fare confirmation has expired. Confirm the fare again.');
  }
  return confirmation;
}

function assertBlockUsable(block, amount, now = Date.now()) {
  if (!block || block.status !== 'ACCEPTED') {
    throw AppError.validation('Payment requires a successful flight block');
  }
  if (block.expiresAt && new Date(block.expiresAt).getTime() <= now) {
    throw AppError.validation('The flight block has expired. Block the fare again before paying.');
  }
  if (block.priceChangePending) {
    throw AppError.validation('Accept the updated fare before paying.');
  }
  if (Number(block.amount) !== Number(amount)) {
    throw AppError.validation('Payment amount does not match the blocked fare');
  }
}

module.exports = {
  BLOCK_TTL_MS,
  newJourneyId,
  newBlockRef,
  selectJourneyForOffer,
  assertSameSupplier,
  assertFareConfirmation,
  assertBlockUsable,
};
