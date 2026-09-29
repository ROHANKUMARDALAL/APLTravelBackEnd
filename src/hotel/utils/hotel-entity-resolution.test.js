'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCandidate } = require('./hotel-normalization');
const { resolveHotels } = require('./hotel-entity-resolution');

function candidate(partial) {
  return {
    city: 'New Delhi',
    country: 'India',
    countryIso2: 'IN',
    roomName: 'Deluxe',
    refundable: true,
    supplierPrice: { amount: 9000, currency: 'INR' },
    checkIn: '2026-10-01',
    checkOut: '2026-10-02',
    ...partial,
  };
}

describe('HotelEntityResolution', () => {
  it('merges Novotel Aerocity variants from three suppliers into one APL hotel', () => {
    const records = [
      candidate({
        supplier: 'TBO',
        supplierHotelId: '123456',
        supplierOfferId: 'A',
        name: 'Novotel New Delhi Aerocity',
        addressLine1: 'Asset 2, Aerocity',
        postalCode: '110037',
        latitude: 28.5503,
        longitude: 77.1225,
        phone: '+91-11-41212121',
      }),
      candidate({
        supplier: 'TRIPJACK',
        supplierHotelId: 'TJ-98765',
        supplierOfferId: 'B',
        name: 'NOVOTEL NEW DELHI AEROCITY',
        addressLine1: 'Asset No. 2, Hospitality District, Aerocity',
        postalCode: '110037',
        latitude: 28.5505,
        longitude: 77.1227,
        phone: '011-41212121',
      }),
      candidate({
        supplier: 'KAFILA',
        supplierHotelId: 'K-45678',
        supplierOfferId: 'C',
        name: 'Novotel New Delhi Aerocity - Delhi',
        addressLine1: 'Asset 2 Aerocity Road',
        postalCode: '110037',
        latitude: 28.5501,
        longitude: 77.1224,
        phone: '91-11-41212121',
      }),
    ].map((c) => normalizeCandidate(c));

    const clusters = resolveHotels(records);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].members.length, 3);
    assert.match(clusters[0].aplHotelId, /^APL-HOTEL-\d{6}$/);
  });

  it('does not merge a similarly named but geographically different hotel', () => {
    const records = [
      candidate({
        supplier: 'TBO',
        supplierHotelId: '123456',
        supplierOfferId: 'A',
        name: 'Novotel New Delhi Aerocity',
        addressLine1: 'Asset 2, Aerocity',
        postalCode: '110037',
        latitude: 28.5503,
        longitude: 77.1225,
        phone: '+91-11-41212121',
      }),
      candidate({
        supplier: 'TBO',
        supplierHotelId: '778899',
        supplierOfferId: 'D',
        name: 'Hotel Novotel Delhi Connaught Place',
        addressLine1: 'Barakhamba Road, Connaught Place',
        postalCode: '110001',
        latitude: 28.6315,
        longitude: 77.2167,
        phone: '+91-11-40000000',
      }),
    ].map((c) => normalizeCandidate(c));

    const clusters = resolveHotels(records);
    assert.equal(clusters.length, 2);
  });
});
