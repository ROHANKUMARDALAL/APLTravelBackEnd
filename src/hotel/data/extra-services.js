'use strict';

/** Mock room extra services. Each code is charged once per stay. */
function hotelExtraServices(currency = 'INR') {
  const price = (amount) => ({ amount, currency });
  return [
    { code: 'BREAKFAST', name: 'Breakfast', price: price(800) },
    { code: 'LATE_CHECKOUT', name: 'Late checkout', price: price(1500) },
    { code: 'AIRPORT_TRANSFER', name: 'Airport transfer', price: price(1800) },
  ];
}

module.exports = { hotelExtraServices };
