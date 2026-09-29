'use strict';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCityKey(city) {
  return city.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isDelhiSearch(city) {
  const key = normalizeCityKey(city);
  return key === 'new delhi' || key === 'delhi' || key === 'delhi ncr';
}

module.exports = { delay, normalizeCityKey, isDelhiSearch };
