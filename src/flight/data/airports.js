'use strict';

/**
 * Metro / city → airports catalogue (mock).
 * City codes (e.g. DEL) expand to all airports in that metro for multi-airport search.
 */

const CITIES = [
  {
    cityCode: 'DEL',
    cityName: 'Delhi',
    country: 'India',
    countryIso2: 'IN',
    aliases: ['delhi', 'new delhi', 'delhi ncr', 'ncr', 'del'],
    airports: [
      {
        airportCode: 'DEL',
        airportName: 'Indira Gandhi International Airport',
        shortName: 'IGI',
        area: 'Aerocity / Palam',
        isPrimary: true,
      },
      {
        airportCode: 'HDO',
        airportName: 'Hindon Airport',
        shortName: 'Hindon',
        area: 'Ghaziabad',
        isPrimary: false,
      },
      {
        airportCode: 'DXN',
        airportName: 'Noida International Airport',
        shortName: 'Noida International',
        area: 'Jewar',
        isPrimary: false,
      },
    ],
  },
  {
    cityCode: 'BOM',
    cityName: 'Mumbai',
    country: 'India',
    countryIso2: 'IN',
    aliases: ['mumbai', 'bombay', 'bom'],
    airports: [
      {
        airportCode: 'BOM',
        airportName: 'Chhatrapati Shivaji Maharaj International Airport',
        shortName: 'CSIA',
        area: 'Andheri / Sahar',
        isPrimary: true,
      },
    ],
  },
  {
    cityCode: 'BLR',
    cityName: 'Bengaluru',
    country: 'India',
    countryIso2: 'IN',
    aliases: ['bangalore', 'bengaluru', 'blr'],
    airports: [
      {
        airportCode: 'BLR',
        airportName: 'Kempegowda International Airport',
        shortName: 'KIA',
        area: 'Devanahalli',
        isPrimary: true,
      },
    ],
  },
  {
    cityCode: 'HYD',
    cityName: 'Hyderabad',
    country: 'India',
    countryIso2: 'IN',
    aliases: ['hyderabad', 'hyd'],
    airports: [
      {
        airportCode: 'HYD',
        airportName: 'Rajiv Gandhi International Airport',
        shortName: 'RGIA',
        area: 'Shamshabad',
        isPrimary: true,
      },
    ],
  },
];

/** True when every typed letter appears in order, e.g. mba → Mumbai, BOM → BOM. */
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
  const code = String(cityCode || '')
    .trim()
    .toUpperCase();
  return CITIES.find((c) => c.cityCode === code) || null;
}

function getAirportCodesForCity(cityCode) {
  const city = getCityByCode(cityCode);
  if (!city) return [];
  return city.airports.map((a) => a.airportCode);
}

function getAirportMeta(airportCode) {
  const code = String(airportCode || '')
    .trim()
    .toUpperCase();
  for (const city of CITIES) {
    const airport = city.airports.find((a) => a.airportCode === code);
    if (airport) {
      return {
        ...airport,
        cityCode: city.cityCode,
        cityName: city.cityName,
        country: city.country,
        countryIso2: city.countryIso2,
      };
    }
  }
  return null;
}

/**
 * Search airports / cities by free text or city code.
 */
function searchAirports({ query, cityCode } = {}) {
  if (cityCode) {
    const city = getCityByCode(cityCode);
    if (!city) return { cities: [], airports: [] };
    return {
      cities: [
        {
          cityCode: city.cityCode,
          cityName: city.cityName,
          country: city.country,
          countryIso2: city.countryIso2,
          airportCount: city.airports.length,
        },
      ],
      airports: city.airports.map((a) => ({
        ...a,
        cityCode: city.cityCode,
        cityName: city.cityName,
        country: city.country,
        countryIso2: city.countryIso2,
      })),
    };
  }

  const q = normalizeQuery(query);
  if (!q || q.length < 3) {
    return { cities: [], airports: [] };
  }

  const cities = [];
  const airports = [];

  for (const city of CITIES) {
    const cityFields = [
      city.cityName,
      city.cityCode,
      ...city.aliases,
      ...city.airports.map((airport) => airport.airportCode),
    ];
    const cityHit = fieldMatchesQuery(cityFields, q);

    const matchingAirports = city.airports.filter((airport) =>
      fieldMatchesQuery([airport.airportCode, city.cityName, ...city.aliases], q),
    );

    if (cityHit || matchingAirports.length > 0) {
      cities.push({
        cityCode: city.cityCode,
        cityName: city.cityName,
        country: city.country,
        countryIso2: city.countryIso2,
        airportCount: city.airports.length,
      });
      for (const a of cityHit ? city.airports : matchingAirports) {
        airports.push({
          ...a,
          cityCode: city.cityCode,
          cityName: city.cityName,
          country: city.country,
          countryIso2: city.countryIso2,
        });
      }
    }
  }

  return { cities, airports };
}

module.exports = {
  CITIES,
  getCityByCode,
  getAirportCodesForCity,
  getAirportMeta,
  searchAirports,
};
