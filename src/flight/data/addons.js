'use strict';

/** Mock seat / baggage / meal catalogue. Prices are per selected code. */
function flightAddOnCatalog(currency = 'INR') {
  const price = (amount) => ({ amount, currency });
  return {
    seats: [
      { code: '12A', label: 'Seat 12A', price: price(450) },
      { code: '12C', label: 'Seat 12C', price: price(450) },
      { code: '14F', label: 'Seat 14F', price: price(650) },
    ],
    baggage: [
      { code: 'BG15', label: 'Extra 15 kg', price: price(1200) },
      { code: 'BG30', label: 'Extra 30 kg', price: price(2200) },
    ],
    meals: [
      { code: 'VGML', label: 'Veg meal', price: price(350) },
      { code: 'NVML', label: 'Non-veg meal', price: price(400) },
    ],
  };
}

module.exports = { flightAddOnCatalog };
