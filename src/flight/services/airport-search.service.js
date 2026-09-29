'use strict';

const { AppError } = require('../../common/errors/app-error');
const { searchAirports } = require('../data/airports');

function validateAirportSearchBody(body) {
  const data = body || {};
  const query = data.query != null ? String(data.query).trim() : '';
  const cityCode = data.cityCode
    ? String(data.cityCode).trim().toUpperCase()
    : undefined;

  if (!query && !cityCode) {
    throw AppError.validation('Provide query (e.g. Delhi) or cityCode (e.g. DEL)');
  }
  if (query && query.length < 3) {
    throw AppError.validation('query must be at least 3 characters');
  }

  return { query: query || undefined, cityCode };
}

function searchCityAirports(dto) {
  const result = searchAirports(dto);
  return {
    query: dto.query || null,
    cityCode: dto.cityCode || null,
    cities: result.cities,
    airports: result.airports,
    tip: 'Use cityCode (e.g. DEL) in POST /api/v1/flights/search as originCityCode / destinationCityCode to search all airports in that metro.',
  };
}

module.exports = {
  validateAirportSearchBody,
  searchCityAirports,
};
