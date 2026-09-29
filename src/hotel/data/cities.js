'use strict';

/**
 * Hotel city catalogue. Live hotel suppliers (TBO, TripJack) return a numeric
 * CityId, not an IATA letter code. These fixtures use that same numeric form.
 * Mock hotel inventory is richest for 130443 (New Delhi).
 */

const CITIES = [
  {
    cityCode: '130443',
    cityName: 'New Delhi',
    state: 'Delhi',
    country: 'India',
    countryIso2: 'IN',
    aliases: ['delhi', 'new delhi', 'delhi ncr', 'ncr', '130443'],
  },
  {
    cityCode: '144306',
    cityName: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    countryIso2: 'IN',
    aliases: ['mumbai', 'bombay', '144306'],
  },
  {
    cityCode: '113128',
    cityName: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    countryIso2: 'IN',
    aliases: ['bangalore', 'bengaluru', '113128'],
  },
  {
    cityCode: '119233',
    cityName: 'Goa',
    state: 'Goa',
    country: 'India',
    countryIso2: 'IN',
    aliases: ['goa', 'panaji', '119233'],
  },
  {
    cityCode: '121881',
    cityName: 'Jaipur',
    state: 'Rajasthan',
    country: 'India',
    countryIso2: 'IN',
    aliases: ['jaipur', '121881'],
  },
];

/** True when every typed letter appears in order, e.g. mba → Mumbai, bom → BOM. */
function lettersInOrder(value, query) {
  const text = String(value || '').toLowerCase();
  const needle = String(query || '').toLowerCase();
  if (!text || !needle) return false;
  let index = 0;
  for (const char of text) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function fieldMatchesQuery(fields, query) {
  return fields.some((field) => lettersInOrder(field, query));
}

function normalizeQuery(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getCityByCode(cityCode) {
  const code = String(cityCode ?? '').trim();
  if (!/^\d+$/.test(code)) return null;
  return CITIES.find((c) => c.cityCode === code) || null;
}

function toPublicCity(city) {
  return {
    cityCode: city.cityCode,
    cityName: city.cityName,
    state: city.state,
    country: city.country,
    countryIso2: city.countryIso2,
  };
}

function searchHotelCities({ query, cityCode } = {}) {
  if (cityCode) {
    const city = getCityByCode(cityCode);
    return { cities: city ? [toPublicCity(city)] : [] };
  }

  const q = normalizeQuery(query);
  if (!q || q.length < 3) return { cities: [] };

  const cities = CITIES.filter((city) =>
    fieldMatchesQuery([city.cityName, city.cityCode, city.state, ...city.aliases], q),
  ).map(toPublicCity);

  return { cities };
}

module.exports = {
  CITIES,
  getCityByCode,
  searchHotelCities,
};
