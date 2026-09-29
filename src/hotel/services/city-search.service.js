'use strict';

const { AppError } = require('../../common/errors/app-error');
const { searchHotelCities } = require('../data/cities');

function validateCitySearchBody(body) {
  const data = body || {};
  const query = data.query != null ? String(data.query).trim() : '';
  const cityCode =
    data.cityCode != null && String(data.cityCode).trim()
      ? String(data.cityCode).trim()
      : undefined;

  if (!query && !cityCode) {
    throw AppError.validation(
      'Provide query (e.g. Delhi) or numeric cityCode (e.g. 130443)',
    );
  }
  if (cityCode && !/^\d+$/.test(cityCode)) {
    throw AppError.validation('cityCode must be numeric (supplier CityId), e.g. 130443');
  }
  if (query && query.length < 3) {
    throw AppError.validation('query must be at least 3 characters');
  }

  return { query: query || undefined, cityCode };
}

function searchCities(dto) {
  const result = searchHotelCities(dto);
  return {
    query: dto.query || null,
    cityCode: dto.cityCode || null,
    cities: result.cities,
    tip: 'Use numeric cityCode (e.g. 130443 for New Delhi) in POST /api/v1/hotels/search.',
  };
}

module.exports = { validateCitySearchBody, searchCities };
