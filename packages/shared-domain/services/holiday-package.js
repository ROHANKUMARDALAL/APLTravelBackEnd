'use strict';

const crypto = require('crypto');
const { HolidayPackage } = require('../models');
const { DomainError } = require('./domain-error');

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function lines(value) {
  if (Array.isArray(value)) return value.map((row) => clean(row, 300)).filter(Boolean);
  return String(value || '')
    .split('\n')
    .map((row) => clean(row, 300))
    .filter(Boolean);
}

function slugify(title) {
  const base = clean(title, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'holiday'}-${suffix}`;
}

function itinerary(value) {
  if (!Array.isArray(value)) return [];
  return value.map((day, index) => ({
    dayNumber: Number(day?.dayNumber) || index + 1,
    title: clean(day?.title, 160),
    description: clean(day?.description, 4000),
    activities: lines(day?.activities),
    images: lines(day?.images).slice(0, 8),
  }));
}

function assignPackage(doc, input, { creating } = {}) {
  const title = clean(input.title, 180);
  if (!title) throw new DomainError('Package title is required', 400, [{ field: 'title' }]);
  const destinationCity = clean(input.destinationCity, 80);
  const destinations = lines(input.destinations);
  if (!destinationCity && !destinations.length) {
    throw new DomainError('A destination is required', 400, [{ field: 'destinationCity' }]);
  }
  const durationDays = Number(input.durationDays);
  const durationNights = Number(input.durationNights);
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new DomainError('Duration days must be at least 1', 400, [{ field: 'durationDays' }]);
  }
  if (!Number.isInteger(durationNights) || durationNights < 0) {
    throw new DomainError('Duration nights cannot be negative', 400, [{ field: 'durationNights' }]);
  }
  const startingPrice = Number(input.startingPrice);
  if (!Number.isFinite(startingPrice) || startingPrice < 0) {
    throw new DomainError('Starting price must be zero or more', 400, [{ field: 'startingPrice' }]);
  }
  const currency = clean(input.currency || 'INR', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new DomainError('Currency must be a 3-letter code');
  const priceType = clean(input.priceType || 'INDICATIVE', 20).toUpperCase();
  if (!['INDICATIVE', 'FIXED'].includes(priceType)) throw new DomainError('Price type must be INDICATIVE or FIXED');
  const packageCategory = clean(input.packageCategory || doc.packageCategory || 'HOLIDAY', 40).toUpperCase();
  if (!['HOLIDAY', 'GROUP_DEPARTURE'].includes(packageCategory)) {
    throw new DomainError('Package category must be HOLIDAY or GROUP_DEPARTURE', 400, [{ field: 'packageCategory' }]);
  }

  doc.title = title;
  if (creating || input.slug) doc.slug = creating ? slugify(title) : clean(input.slug, 180).toLowerCase();
  doc.shortDescription = clean(input.shortDescription, 400);
  doc.fullDescription = clean(input.fullDescription, 8000);
  doc.destinationCountry = clean(input.destinationCountry, 80);
  doc.destinationState = clean(input.destinationState, 80);
  doc.destinationCity = destinationCity;
  doc.destinations = destinations.length ? destinations : [destinationCity].filter(Boolean);
  doc.isInternational = input.isInternational === true || input.isInternational === 'true';
  doc.durationDays = durationDays;
  doc.durationNights = durationNights;
  doc.startingPrice = startingPrice;
  doc.currency = currency;
  doc.priceType = priceType;
  doc.packageCategory = packageCategory;
  doc.packageImages = lines(input.packageImages).slice(0, 12);
  doc.coverImage = clean(input.coverImage, 500) || doc.packageImages[0] || '';
  doc.highlights = lines(input.highlights);
  doc.inclusions = lines(input.inclusions);
  doc.exclusions = lines(input.exclusions);
  doc.itinerary = itinerary(input.itinerary);
  doc.hotelInformation = clean(input.hotelInformation, 4000);
  doc.transportationInformation = clean(input.transportationInformation, 4000);
  doc.mealsIncluded = clean(input.mealsIncluded, 500);
  doc.availableTravelDates = lines(input.availableTravelDates);
  doc.bookingTerms = clean(input.bookingTerms, 4000);
  doc.cancellationPolicy = clean(input.cancellationPolicy, 4000);
  doc.termsAndConditions = clean(input.termsAndConditions, 8000);
  doc.enquiryEnabled = input.enquiryEnabled !== false && input.enquiryEnabled !== 'false';
  doc.displayOrder = Number.isFinite(Number(input.displayOrder)) ? Number(input.displayOrder) : doc.displayOrder || 100;
}

function presentPackage(doc) {
  if (!doc) return null;
  const row = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(row._id),
    dsaId: String(row.dsaId),
    packageCode: row.packageCode,
    title: row.title,
    slug: row.slug,
    shortDescription: row.shortDescription || '',
    fullDescription: row.fullDescription || '',
    destinationCountry: row.destinationCountry || '',
    destinationState: row.destinationState || '',
    destinationCity: row.destinationCity || '',
    destinations: row.destinations || [],
    isInternational: row.isInternational === true,
    durationDays: row.durationDays,
    durationNights: row.durationNights,
    startingPrice: row.startingPrice,
    currency: row.currency,
    priceType: row.priceType || 'INDICATIVE',
    packageCategory: row.packageCategory === 'GROUP_DEPARTURE' ? 'GROUP_DEPARTURE' : 'HOLIDAY',
    priceLabel: row.priceType === 'FIXED' ? 'Package price' : 'Indicative price',
    packageImages: row.packageImages || [],
    coverImage: row.coverImage || (row.packageImages || [])[0] || '',
    highlights: row.highlights || [],
    inclusions: row.inclusions || [],
    exclusions: row.exclusions || [],
    itinerary: row.itinerary || [],
    hotelInformation: row.hotelInformation || '',
    transportationInformation: row.transportationInformation || '',
    mealsIncluded: row.mealsIncluded || '',
    availableTravelDates: row.availableTravelDates || [],
    bookingTerms: row.bookingTerms || '',
    cancellationPolicy: row.cancellationPolicy || '',
    termsAndConditions: row.termsAndConditions || '',
    enquiryEnabled: row.enquiryEnabled !== false,
    status: row.status,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function publicPackage(doc) {
  const row = presentPackage(doc);
  if (!row) return null;
  delete row.dsaId;
  return row;
}

async function createHolidayPackage({ dsaId, actorId, input }) {
  if (!dsaId) throw new DomainError('DSA is required', 403);
  const doc = new HolidayPackage({
    dsaId,
    packageCode: `HOL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    createdBy: String(actorId || ''),
    updatedBy: String(actorId || ''),
    status: 'DRAFT',
  });
  assignPackage(doc, input || {}, { creating: true });
  await doc.save();
  return presentPackage(doc);
}

async function updateHolidayPackage({ dsaId, packageId, actorId, input }) {
  const doc = await HolidayPackage.findOne({ _id: packageId, dsaId });
  if (!doc) throw new DomainError('Holiday package not found', 404);
  if (doc.status === 'ARCHIVED') throw new DomainError('Archived packages cannot be edited', 400);
  assignPackage(doc, { ...presentPackage(doc), ...input }, { creating: false });
  doc.updatedBy = String(actorId || '');
  await doc.save();
  return presentPackage(doc);
}

async function setHolidayPackageStatus({ dsaId, packageId, actorId, status }) {
  const next = String(status || '').toUpperCase();
  if (!['PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DRAFT'].includes(next)) {
    throw new DomainError('Unsupported package status');
  }
  const doc = await HolidayPackage.findOne({ _id: packageId, dsaId });
  if (!doc) throw new DomainError('Holiday package not found', 404);
  if (next === 'PUBLISHED' && !doc.shortDescription) {
    throw new DomainError('Add a short description before publishing', 400, [{ field: 'shortDescription' }]);
  }
  doc.status = next;
  doc.updatedBy = String(actorId || '');
  await doc.save();
  return presentPackage(doc);
}

async function listHolidayPackages({ dsaId, status, q, destination } = {}) {
  const filter = { dsaId };
  if (status) filter.status = String(status).toUpperCase();
  if (destination) filter.destinationCity = new RegExp(clean(destination, 80), 'i');
  if (q) {
    const pattern = new RegExp(clean(q, 80), 'i');
    filter.$or = [{ title: pattern }, { packageCode: pattern }, { destinationCity: pattern }];
  }
  const rows = await HolidayPackage.find(filter).sort({ displayOrder: 1, updatedAt: -1 }).lean();
  return rows.map(presentPackage);
}

async function getHolidayPackage({ dsaId, packageId, slug }) {
  const filter = { dsaId };
  if (packageId) filter._id = packageId;
  else filter.slug = clean(slug, 180).toLowerCase();
  const doc = await HolidayPackage.findOne(filter).lean();
  if (!doc) throw new DomainError('Holiday package not found', 404);
  return presentPackage(doc);
}

function destinationKey(type, name) {
  return `${type}:${String(name || '').trim().toLowerCase()}`;
}

async function listPublicHolidayDestinations(dsaId, query = {}) {
  const rows = await HolidayPackage.find({
    dsaId,
    status: 'PUBLISHED',
    enquiryEnabled: { $ne: false },
  })
    .select('destinationCity destinationState destinationCountry destinations displayOrder')
    .sort({ displayOrder: 1, title: 1 })
    .lean();
  const seen = new Map();
  function add(name, type, hierarchy, order) {
    const label = String(name || '').trim();
    if (!label) return;
    const id = destinationKey(type, label);
    if (seen.has(id)) return;
    seen.set(id, { id, name: label, type, hierarchy: hierarchy || '', order: Number(order) || 0 });
  }
  rows.forEach((row, index) => {
    const country = String(row.destinationCountry || '').trim();
    const state = String(row.destinationState || '').trim();
    const city = String(row.destinationCity || '').trim();
    const place = [state, country].filter((part) => part && part.toLowerCase() !== city.toLowerCase()).join(', ');
    if (city) add(city, 'City', place, row.displayOrder ?? index);
    if (state) add(state, 'State', country && country.toLowerCase() !== state.toLowerCase() ? country : '', row.displayOrder ?? index);
    if (country) add(country, 'Country', '', row.displayOrder ?? index);
    (row.destinations || []).forEach((name) => {
      const extra = String(name || '').trim();
      if (!extra) return;
      const known = [city, state, country].some((part) => part.toLowerCase() === extra.toLowerCase());
      if (!known) add(extra, 'City', place, row.displayOrder ?? index);
    });
  });
  let items = [...seen.values()];
  const q = clean(query.q, 80).trim();
  if (q) {
    if (q.length < 3) return [];
    const needle = q.toLowerCase();
    items = items.filter((item) => (
      item.name.toLowerCase().includes(needle) || item.hierarchy.toLowerCase().includes(needle)
    ));
  }
  items.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return items.slice(0, q ? 8 : 6).map(({ order, ...item }) => item);
}

async function listPublicHolidayPackages(dsaId, query = {}) {
  const filter = { dsaId, status: 'PUBLISHED', enquiryEnabled: { $ne: false } };
  if (query.destination) {
    const pattern = new RegExp(clean(query.destination, 80), 'i');
    filter.$or = [
      { destinationCity: pattern },
      { destinationState: pattern },
      { destinationCountry: pattern },
      { destinations: pattern },
    ];
  }
  if (query.travelType === 'international') filter.isInternational = true;
  if (query.travelType === 'domestic') filter.isInternational = false;
  if (query.q) filter.title = new RegExp(clean(query.q, 80), 'i');
  let rows = await HolidayPackage.find(filter).sort({ displayOrder: 1, title: 1 }).lean();
  const minDays = Number(query.minDays);
  const maxDays = Number(query.maxDays);
  const minPrice = Number(query.minPrice);
  const maxPrice = Number(query.maxPrice);
  if (Number.isFinite(minDays)) rows = rows.filter((row) => row.durationDays >= minDays);
  if (Number.isFinite(maxDays) && query.maxDays !== '') rows = rows.filter((row) => row.durationDays <= maxDays);
  if (Number.isFinite(minPrice)) rows = rows.filter((row) => row.startingPrice >= minPrice);
  if (Number.isFinite(maxPrice) && query.maxPrice !== '') rows = rows.filter((row) => row.startingPrice <= maxPrice);
  return rows.map(publicPackage);
}

async function getPublicHolidayPackage(dsaId, slug) {
  const doc = await HolidayPackage.findOne({
    dsaId,
    slug: clean(slug, 180).toLowerCase(),
    status: 'PUBLISHED',
  }).lean();
  if (!doc) throw new DomainError('Holiday package not found', 404);
  return publicPackage(doc);
}

function packageSnapshot(pkg) {
  return {
    packageId: pkg.id || String(pkg._id),
    packageCode: pkg.packageCode,
    title: pkg.title,
    slug: pkg.slug,
    destinationCity: pkg.destinationCity || '',
    destinationCountry: pkg.destinationCountry || '',
    destinations: pkg.destinations || [],
    isInternational: pkg.isInternational === true,
    durationDays: pkg.durationDays,
    durationNights: pkg.durationNights,
    startingPrice: pkg.startingPrice,
    currency: pkg.currency,
    priceType: pkg.priceType || 'INDICATIVE',
    packageCategory: pkg.packageCategory === 'GROUP_DEPARTURE' ? 'GROUP_DEPARTURE' : 'HOLIDAY',
  };
}

module.exports = {
  presentPackage,
  publicPackage,
  createHolidayPackage,
  updateHolidayPackage,
  setHolidayPackageStatus,
  listHolidayPackages,
  getHolidayPackage,
  listPublicHolidayPackages,
  listPublicHolidayDestinations,
  getPublicHolidayPackage,
  packageSnapshot,
};
