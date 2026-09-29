'use strict';

function getMockKafilaHotels(criteria) {
  const currency = criteria.currency || 'INR';
  return [
    {
      supplier: 'KAFILA',
      supplierHotelId: 'K-45678',
      supplierOfferId: 'KAF-OFF-301',
      supplierReference: 'KAF-BOOK-301',
      name: 'Novotel New Delhi Aerocity - Delhi',
      addressLine1: 'Asset 2 Aerocity Road',
      city: 'New Delhi',
      country: 'India',
      countryIso2: 'IN',
      postalCode: '110037',
      latitude: 28.5501,
      longitude: 77.1224,
      phone: '91-11-41212121',
      starRating: 5,
      roomName: 'Deluxe King',
      mealPlan: 'CP',
      refundable: true,
      supplierPrice: { amount: 9100, currency },
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
      raw: { mock: true, source: 'kafila', hotelId: 'K-45678' },
    },
    {
      supplier: 'KAFILA',
      supplierHotelId: 'K-88901',
      supplierOfferId: 'KAF-OFF-410',
      supplierReference: 'KAF-BOOK-410',
      name: 'Andaz Delhi',
      addressLine1: 'Asset No.1, Aerocity',
      city: 'New Delhi',
      country: 'India',
      countryIso2: 'IN',
      postalCode: '110037',
      latitude: 28.5521,
      longitude: 77.1209,
      phone: '+91-11-49031234',
      starRating: 5,
      roomName: 'Andaz King',
      mealPlan: 'Breakfast',
      refundable: true,
      supplierPrice: { amount: 14200, currency },
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
      raw: { mock: true, source: 'kafila', hotelId: 'K-88901' },
    },
  ];
}

module.exports = { getMockKafilaHotels };
