'use strict';

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100) / 100;
}

function customerPayable(offer, markupPercent = 0) {
  const base = money(offer?.customerPayable ?? offer?.total ?? offer?.price?.amount);
  if (base == null) return null;
  if (offer?.priceComplete === false) return null;
  const markup = Number(markupPercent) || 0;
  if (markup < 0) return null;
  return money(base * (1 + markup / 100));
}

function flightKey(offer) {
  const segments = Array.isArray(offer.segments) ? offer.segments : [];
  const segmentKey = segments.map((segment) => [
    segment.airline,
    segment.flightNumber,
    segment.origin,
    segment.destination,
    segment.departureAt,
    segment.arrivalAt,
  ].join(':')).join('>');
  const baggage = offer.baggage || {};
  return [
    segmentKey,
    offer.cabin || '',
    offer.fareBrand || offer.fareType || '',
    baggage.cabinKg ?? '',
    baggage.checkinKg ?? '',
    offer.refundable === true ? 'R' : 'N',
    offer.conditions || '',
    offer.passengers || '',
    offer.currency || 'INR',
  ].join('|');
}

function hotelKey(offer) {
  if (!offer.propertyId) return null;
  return [
    offer.propertyId,
    offer.checkIn || '',
    offer.checkOut || '',
    offer.occupancy || '',
    offer.roomCategory || '',
    offer.mealPlan || '',
    offer.refundable === true ? 'R' : 'N',
    offer.cancellation || '',
    offer.paymentTerms || '',
    offer.currency || 'INR',
  ].join('|');
}

function selectLowest(offers, keyFn, markupPercent = 0) {
  const groups = new Map();
  const preserved = [];
  for (const offer of offers) {
    const payable = customerPayable(offer, markupPercent);
    const key = payable == null ? null : keyFn(offer);
    if (!key) {
      preserved.push({ ...offer, comparable: false, customerPayable: payable });
      continue;
    }
    const row = { ...offer, comparable: true, customerPayable: payable, comparabilityKey: key };
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { displayed: row, alternatives: [] });
      continue;
    }
    if (row.customerPayable < current.displayed.customerPayable) {
      current.alternatives.push(publicAlternative(current.displayed));
      current.displayed = row;
    } else {
      current.alternatives.push(publicAlternative(row));
    }
  }
  const displayed = [...groups.values()].map((group) => ({
    ...group.displayed,
    alternatives: group.alternatives,
  }));
  return { displayed, preserved };
}

function publicAlternative(offer) {
  return {
    supplierCode: offer.supplierCode,
    supplierOfferRef: offer.supplierOfferRef || '',
    customerPayable: offer.customerPayable,
    currency: offer.currency || 'INR',
    credentialConfigId: offer.credentialConfigId || '',
  };
}

function selectLowestFlights(offers, markupPercent) {
  return selectLowest(offers, flightKey, markupPercent);
}

function selectLowestHotels(offers, markupPercent) {
  return selectLowest(offers, hotelKey, markupPercent);
}

module.exports = {
  customerPayable,
  flightKey,
  hotelKey,
  selectLowestFlights,
  selectLowestHotels,
};
