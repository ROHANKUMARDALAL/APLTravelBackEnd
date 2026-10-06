'use strict';

const crypto = require('crypto');
const { config } = require('../../common/config');
const { AppError, ErrorCode } = require('../../common/errors/app-error');
const { formatAplSearchId } = require('../../common/utils/apl-ids');
const { getAllAdapters } = require('../suppliers/registry');
const { normalizeCandidate } = require('../utils/hotel-normalization');
const { resolveHotels } = require('../utils/hotel-entity-resolution');
const { consolidateOffers, sanitizeHotelSearchForPublic } = require('../utils/offer-consolidation');
const { createPricingContext } = require('../../pricing/services/pricing-engine.service');
const Supplier = require('../../common/database/models/Supplier');
const SupplierMapping = require('../../common/database/models/SupplierMapping');
const { logSupplierOutcomes } = require('../../common/services/service-log.service');
const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');
const {
  buildSupplierExecutionPlan,
} = require('../../suppliers/services/supplier-routing.service');
const Hotel = require('../models/Hotel');
const Search = require('../../common/database/models/Search');
const { hotelExtraServices } = require('../data/extra-services');
const {
  assertSearchTenantMatch,
} = require('../../tenant/services/transaction-tenant.service');

function assertDateRange(checkIn, checkOut) {
  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);
  if (Number.isNaN(inDate.getTime()) || Number.isNaN(outDate.getTime())) {
    throw AppError.validation('Invalid check-in or check-out date');
  }
  if (outDate <= inDate) {
    throw AppError.validation('checkOut must be after checkIn');
  }
}

async function ensureSuppliers() {
  const defs = [
    { code: 'TBO', name: 'TBO (Mock)' },
    { code: 'TRIPJACK', name: 'TripJack (Mock)' },
    { code: 'KAFILA', name: 'Kafila (Mock)' },
  ];

  for (const def of defs) {
    await Supplier.findOneAndUpdate(
      { code: def.code },
      {
        $set: {
          name: def.name,
          status: 'ACTIVE',
          isMock: true,
        },
      },
      { upsert: true, new: true },
    );
  }
}

async function persistSearchArtifacts({
  aplSearchId,
  criteria,
  status,
  hotels,
  supplierMeta,
  settled,
  context = {},
}) {
  await ensureSuppliers();

  await Search.create({
    aplSearchId,
    type: 'HOTEL',
    status,
    dsaId: context.dsaId || undefined,
    requestId: context.requestId || undefined,
    request: criteria,
    results: {
      searchId: aplSearchId,
      status,
      hotels,
      suppliers: supplierMeta,
    },
    resultCount: hotels.length,
    supplierResults: supplierMeta.map((meta) => ({
      supplierCode: meta.supplier,
      status: meta.status,
      durationMs: meta.durationMs,
      errorCode: meta.errorCode,
      errorMessage: meta.errorMessage,
      rawResultCount: meta.rawResultCount,
    })),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  await logSupplierOutcomes({
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'HOTEL',
    operation: 'searchHotels',
    searchId: aplSearchId,
    userRequest: criteria,
    settled,
  });

  await writeLifecycleLog({
    stage: 'NORMALIZED_RESPONSE',
    direction: 'SUPPLIER',
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'HOTEL',
    operation: 'searchHotels',
    searchId: aplSearchId,
    status: status === 'COMPLETED' ? 'SUCCESS' : 'PARTIAL',
    result: {
      searchId: aplSearchId,
      status,
      hotelCount: hotels.length,
      suppliers: supplierMeta,
    },
  });

  for (const hotel of hotels) {
    const rooms = hotel.availableRooms || hotel.offers || [];
    const offerDocs = rooms.map((offer) => ({
      aplOfferId: offer.aplRoomId || offer.aplOfferId,
      supplierCode: offer.supplier,
      supplierOfferId: offer.supplierOfferId,
      supplierHotelId: offer.supplierHotelId,
      supplierReference: offer.supplierReference,
      roomName: offer.roomName,
      mealPlan: offer.mealPlan,
      refundable: offer.cancellation.refundable,
      supplierAmount: offer.supplierPrice.amount,
      supplierCurrency: offer.supplierPrice.currency,
      customerAmount: offer.price.amount,
      customerCurrency: offer.price.currency,
      checkIn: new Date(criteria.checkIn),
      checkOut: new Date(criteria.checkOut),
    }));

    await Hotel.findOneAndUpdate(
      { aplHotelId: hotel.aplHotelId },
      {
        $set: {
          name: hotel.name,
          normalizedName: hotel.name.toLowerCase(),
          addressLine1: hotel.location.addressLine1,
          cityName: hotel.location.city,
          countryName: hotel.location.country,
          countryIso2: hotel.location.countryIso2,
          postalCode: hotel.location.postalCode,
          latitude: hotel.location.latitude,
          longitude: hotel.location.longitude,
          phone: hotel.phone,
          starRating: hotel.starRating,
          offers: offerDocs,
        },
      },
      { upsert: true, new: true },
    );

    for (const mapping of hotel.supplierMappings) {
      await SupplierMapping.findOneAndUpdate(
        {
          supplierCode: mapping.supplier,
          entityType: 'HOTEL',
          supplierEntityId: mapping.supplierHotelId,
        },
        {
          $set: {
            aplEntityId: hotel.aplHotelId,
          },
        },
        { upsert: true, new: true },
      );
    }
  }
}

async function searchHotels(dto, forcedFailureList, context = {}) {
  const failureList = forcedFailureList ?? config.mockSupplierFailures;
  assertDateRange(dto.checkIn, dto.checkOut);

  const criteria = {
    cityCode: dto.cityCode || null,
    city: dto.city,
    country: dto.country,
    checkIn: dto.checkIn,
    checkOut: dto.checkOut,
    rooms: dto.rooms,
    adults: dto.adults,
    children: dto.children ?? 0,
    childAges: dto.childAges || [],
    currency: (dto.currency || 'INR').toUpperCase(),
  };

  const aplSearchId = formatAplSearchId(
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  );
  const forcedFailures = new Set(failureList);

  await writeLifecycleLog({
    stage: 'NORMALIZED_REQUEST',
    direction: 'INBOUND',
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'HOTEL',
    operation: 'searchHotels',
    searchId: aplSearchId,
    status: 'SUCCESS',
    request: criteria,
  });

  let plan;
  if (context.dsaId) {
    plan = await buildSupplierExecutionPlan({
      dsaId: context.dsaId,
      serviceCode: 'hotel',
      operation: 'searchHotels',
    });
  } else {
    plan = {
      mode: 'LEGACY_MOCK_FANOUT',
      reason: 'NO_TRANSACTION_TENANT',
      strategy: 'PARALLEL',
      suppliers: getAllAdapters().map((adapter, index) => ({
        supplierCode: adapter.code,
        priority: index + 1,
        adapter,
        supplierId: null,
      })),
    };
  }

  const adapterContext = {
    requestId: context.requestId,
    dsaId: context.dsaId,
    service: 'HOTEL',
    operation: 'searchHotels',
    routingMode: plan.mode,
    routingStrategy: plan.strategy,
  };

  const settled = await Promise.all(
    plan.suppliers.map(async (entry) => {
      const adapter = entry.adapter;
      try {
        const outcome = await adapter.searchHotels(criteria, {
          simulateFailure: forcedFailures.has(adapter.code),
          ...adapterContext,
          environment: entry.environment,
        });
        return { adapter, outcome, supplierId: entry.supplierId };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown supplier error';
        console.error(`Supplier ${adapter.code} threw: ${message}`);
        return {
          adapter,
          supplierId: entry.supplierId,
          outcome: {
            status: 'FAILED',
            durationMs: 0,
            errorCode: 'SUPPLIER_EXCEPTION',
            errorMessage: message,
          },
        };
      }
    }),
  );

  const candidates = [];
  const supplierMeta = [];

  for (const { adapter, outcome } of settled) {
    if (outcome.status === 'SUCCESS') {
      console.log(
        `Supplier ${adapter.code} SUCCESS in ${outcome.durationMs}ms (${outcome.hotels.length} hotels)`,
      );
      candidates.push(...outcome.hotels);
      supplierMeta.push({
        supplier: adapter.code,
        status: 'SUCCESS',
        durationMs: outcome.durationMs,
        rawResultCount: outcome.hotels.length,
      });
    } else {
      console.warn(
        `Supplier ${adapter.code} ${outcome.status} in ${outcome.durationMs}ms: ${outcome.errorMessage}`,
      );
      supplierMeta.push({
        supplier: adapter.code,
        status: outcome.status,
        durationMs: outcome.durationMs,
        rawResultCount: 0,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      });
    }
  }

  const normalized = candidates.map((c) => normalizeCandidate(c));
  const clusters = resolveHotels(normalized);
  const pricingContext = await createPricingContext({
    dsaId: context.dsaId || null,
    serviceCode: 'hotel',
  });
  const hotels = consolidateOffers(clusters, pricingContext).sort(
    (a, b) => a.lowestPrice.amount - b.lowestPrice.amount,
  );

  const successCount = supplierMeta.filter((s) => s.status === 'SUCCESS').length;
  const status =
    successCount === 0
      ? 'FAILED'
      : successCount < supplierMeta.length
        ? 'PARTIAL'
        : 'COMPLETED';

  if (status === 'FAILED') {
    throw new AppError(
      ErrorCode.SEARCH_FAILED,
      'All suppliers failed for this hotel search',
      { httpStatus: 502, details: supplierMeta },
    );
  }

  await persistSearchArtifacts({
    aplSearchId,
    criteria,
    status,
    hotels,
    supplierMeta,
    settled,
    context,
  });

  return {
    searchId: aplSearchId,
    status,
    city: {
      cityCode: criteria.cityCode || null,
      cityName: criteria.city,
      country: criteria.country || null,
    },
    stay: {
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
      rooms: criteria.rooms,
      adults: criteria.adults,
      children: criteria.children,
      childAges: criteria.childAges || [],
    },
    hotels,
    suppliers: supplierMeta,
  };
}

async function getHotelSearchOrThrow(searchId) {
  const search = await Search.findOne({ aplSearchId: searchId, type: 'HOTEL' });
  if (!search) throw AppError.notFound(`Hotel search not found: ${searchId}`);
  if (search.expiresAt && search.expiresAt < new Date()) {
    throw AppError.validation('Search has expired. Please search again.');
  }
  return search;
}

function findHotel(results, aplHotelId) {
  if (!results?.hotels) return null;
  return results.hotels.find((h) => h.aplHotelId === aplHotelId) || null;
}

function findRoom(hotel, aplRoomId) {
  const rooms = hotel?.availableRooms || hotel?.offers || [];
  if (!aplRoomId) return null;
  return (
    rooms.find((r) => r.aplRoomId === aplRoomId || r.aplOfferId === aplRoomId) ||
    null
  );
}

async function getHotelDetails({ searchId, aplHotelId, aplRoomId }, context = {}) {
  const search = await getHotelSearchOrThrow(searchId);
  if (context.tenant) {
    assertSearchTenantMatch(search, context.tenant);
  }
  const hotel = findHotel(search.results, aplHotelId);
  if (!hotel) throw AppError.notFound(`Hotel not found in search: ${aplHotelId}`);

  const availableRooms = (hotel.availableRooms || hotel.offers || []).map((room) => ({
    ...room,
    extraServices: hotelExtraServices(room.price?.currency || 'INR'),
  }));
  let selectedRoom = null;
  if (aplRoomId) {
    selectedRoom = findRoom({ availableRooms }, aplRoomId);
    if (!selectedRoom) {
      throw AppError.notFound(`Room not found on hotel ${aplHotelId}: ${aplRoomId}`);
    }
  }

  return {
    searchId,
    aplHotelId: hotel.aplHotelId,
    hotel: {
      aplHotelId: hotel.aplHotelId,
      name: hotel.name,
      location: hotel.location,
      starRating: hotel.starRating,
      phone: hotel.phone,
      supplierMappings: hotel.supplierMappings,
      lowestPrice: hotel.lowestPrice,
    },
    availableRooms,
    selectedRoom,
    policies: {
      checkIn: '14:00',
      checkOut: '11:00',
      notes: [
        'Select one aplRoomId from availableRooms for checkout.',
        'Mock hotel policies for Postman testing.',
      ],
    },
  };
}

async function revalidateHotelOffer(
  { searchId, aplHotelId, aplRoomId },
  context = {},
) {
  if (!aplRoomId) {
    throw AppError.validation(
      'aplRoomId is required for revalidate (select a room from availableRooms)',
    );
  }
  const details = await getHotelDetails(
    { searchId, aplHotelId, aplRoomId },
    context,
  );
  const room = details.selectedRoom;
  return {
    searchId,
    aplHotelId,
    aplRoomId: room.aplRoomId,
    status: 'AVAILABLE',
    priceChanged: false,
    price: room.price,
    supplier: room.supplier,
    supplierReference: room.supplierReference,
    selectedRoom: room,
    validUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}

module.exports = {
  searchHotels,
  getHotelDetails,
  revalidateHotelOffer,
  sanitizeHotelSearchForPublic,
};
