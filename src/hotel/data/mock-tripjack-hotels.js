'use strict';

function getMockTripjackHotels(criteria) {
  const currency = criteria.currency || 'INR';
  return [
    {
      supplier: 'TRIPJACK',
      supplierHotelId: 'TJ-98765',
      supplierOfferId: 'TJ-RATE-4411',
      supplierReference: 'TJ-SESS-4411',
      name: 'NOVOTEL NEW DELHI AEROCITY',
      addressLine1: 'Asset No. 2, Hospitality District, Aerocity',
      city: 'New Delhi',
      country: 'India',
      countryIso2: 'IN',
      postalCode: '110037',
      latitude: 28.5505,
      longitude: 77.1227,
      phone: '011-41212121',
      starRating: 5,
      roomName: 'Deluxe King Room',
      mealPlan: 'Breakfast',
      refundable: true,
      supplierPrice: { amount: 8650, currency },
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
      raw: { mock: true, source: 'tripjack', propertyId: 'TJ-98765' },
    },
    {
      supplier: 'TRIPJACK',
      supplierHotelId: 'TJ-11220',
      supplierOfferId: 'TJ-RATE-5502',
      supplierReference: 'TJ-SESS-5502',
      name: 'The Leela Palace New Delhi',
      addressLine1: 'Diplomatic Enclave, Chanakyapuri',
      city: 'New Delhi',
      country: 'India',
      countryIso2: 'IN',
      postalCode: '110023',
      latitude: 28.5802,
      longitude: 77.1891,
      phone: '+91-11-39331234',
      starRating: 5,
      roomName: 'Premier Room',
      mealPlan: 'Breakfast',
      refundable: true,
      supplierPrice: { amount: 18500, currency },
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
      raw: { mock: true, source: 'tripjack', propertyId: 'TJ-11220' },
    },
  ];
}

module.exports = { getMockTripjackHotels };
