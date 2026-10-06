'use strict';

const crypto = require('crypto');
const { config } = require('../../common/config');
const { AppError, ErrorCode } = require('../../common/errors/app-error');
const { formatAplSearchId } = require('../../common/utils/apl-ids');
const { getAllBusAdapters } = require('../suppliers/registry');
const { normalizeCandidate } = require('../utils/bus-normalization');
const { resolveBuses } = require('../utils/bus-entity-resolution');
const {
  consolidateBusOffers,
  sanitizeBusSearchForPublic,
} = require('../utils/offer-consolidation');
const { createPricingContext } = require('../../pricing/services/pricing-engine.service');
const Supplier = require('../../common/database/models/Supplier');
const { logSupplierOutcomes } = require('../../common/services/service-log.service');
const { writeLifecycleLog } = require('../../common/services/lifecycle-log.service');
const {
  buildSupplierExecutionPlan,
} = require('../../suppliers/services/supplier-routing.service');
const {
  resolveSupplierCredentials,
} = require('../../suppliers/runtime');
const Search = require('../../common/database/models/Search');
const {
  assertSearchTenantMatch,
} = require('../../tenant/services/transaction-tenant.service');
const { searchAplBusLocations } = require('./location.service');

/** Deterministic mock seat layout for checkout (not a real operator map). */
const MOCK_SEAT_MAP = [
  ['1A', '1B', null, '1C', '1D'],
  ['2A', '2B', null, '2C', '2D'],
  ['3A', '3B', null, '3C', '3D'],
  ['4A', '4B', null, '4C', '4D'],
  ['5A', '5B', null, '5C', '5D'],
];
const MOCK_TAKEN_SEATS = ['1A', '2C', '3D', '4B'];

async function ensureBusSuppliers() {
  for (const code of ['MOCKBUS_A', 'MOCKBUS_B']) {
    await Supplier.findOneAndUpdate(
      { code },
      {
        $set: {
          name: `${code} (Mock)`,
          status: 'ACTIVE',
          isMock: true,
          environments: ['TEST'],
          defaultEnvironment: 'TEST',
          credentialRef: `SUPPLIER_${code}`,
          credentialsConfigured: false,
        },
        $setOnInsert: { code },
      },
      { upsert: true, new: true },
    );
  }
}

async function getSearchOrThrow(searchId) {
  const search = await Search.findOne({ aplSearchId: searchId, type: 'BUS' });
  if (!search) throw AppError.notFound(`Bus search not found: ${searchId}`);
  if (search.expiresAt && search.expiresAt < new Date()) {
    throw AppError.validation('Search has expired. Please search again.');
  }
  return search;
}

function findBusInResults(results, aplBusId) {
  return (results?.buses || []).find((b) => b.aplBusId === aplBusId) || null;
}

function findOfferOnBus(bus, aplOfferId) {
  if (!bus?.offers?.length) return null;
  if (aplOfferId) {
    return bus.offers.find((o) => o.aplOfferId === aplOfferId) || null;
  }
  return bus.primaryOffer || bus.offers[0] || null;
}

function buildSeatInventory(bus, offer) {
  const taken = new Set(MOCK_TAKEN_SEATS);
  const available = [];
  for (const row of MOCK_SEAT_MAP) {
    for (const seat of row) {
      if (seat && !taken.has(seat)) available.push(seat);
    }
  }
  return {
    mock: true,
    note: 'Deterministic mock seat map — not a real operator layout',
    maxSelectable: Math.min(6, offer?.seatsLeft || bus?.seatsLeft || 6),
    seatMap: MOCK_SEAT_MAP,
    takenSeats: [...MOCK_TAKEN_SEATS],
    availableSeats: available,
  };
}

async function searchBuses(dto, forcedFailureList, context = {}) {
  const failureList = forcedFailureList ?? config.mockSupplierFailures;
  const criteria = { ...dto };
  const aplSearchId = formatAplSearchId(
    crypto.randomBytes(4).toString('hex').toUpperCase(),
  );
  const forcedFailures = new Set(
    (failureList || []).map((c) => String(c).toUpperCase()),
  );

  await writeLifecycleLog({
    stage: 'NORMALIZED_REQUEST',
    direction: 'INBOUND',
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'BUS',
    operation: 'searchBuses',
    searchId: aplSearchId,
    status: 'SUCCESS',
    request: criteria,
  });

  let plan;
  if (context.dsaId) {
    plan = await buildSupplierExecutionPlan({
      dsaId: context.dsaId,
      serviceCode: 'bus',
      operation: 'searchBuses',
    });
  } else {
    plan = {
      mode: 'LEGACY_MOCK_FANOUT',
      reason: 'NO_TRANSACTION_TENANT',
      strategy: 'PARALLEL',
      suppliers: getAllBusAdapters().map((adapter, index) => ({
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
    service: 'BUS',
    operation: 'searchBuses',
    routingMode: plan.mode,
    routingStrategy: plan.strategy,
  };

  const settled = await Promise.all(
    plan.suppliers.map(async (entry) => {
      const adapter = entry.adapter;
      const started = Date.now();
      try {
        const credentialRef =
          entry.credentialRef ||
          `SUPPLIER_${String(entry.supplierCode || adapter.code).toUpperCase()}`;
        const resolved = resolveSupplierCredentials({
          credentialRef,
          environment: entry.environment || 'TEST',
          supplierCode: entry.supplierCode || adapter.code,
        });

        const outcome = await adapter.searchBuses(criteria, {
          simulateFailure: forcedFailures.has(adapter.code),
          ...adapterContext,
          environment: entry.environment || 'TEST',
          supplierId: entry.supplierId || null,
          credentialRef,
          credentialMeta: resolved.meta,
        });

        return {
          adapter,
          supplierId: entry.supplierId || null,
          outcome: {
            ...outcome,
            durationMs: outcome.durationMs || Date.now() - started,
          },
        };
      } catch (err) {
        return {
          adapter,
          supplierId: entry.supplierId || null,
          outcome: {
            status: 'FAILED',
            durationMs: Date.now() - started,
            errorCode: 'ADAPTER_EXCEPTION',
            errorMessage: err.message,
            buses: [],
          },
        };
      }
    }),
  );

  const candidates = [];
  const supplierMeta = [];
  for (const { adapter, outcome } of settled) {
    supplierMeta.push({
      supplier: adapter.code,
      status: outcome.status,
      durationMs: outcome.durationMs,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      rawResultCount: (outcome.buses || []).length,
    });
    if (outcome.status === 'SUCCESS') {
      for (const bus of outcome.buses || []) {
        candidates.push(normalizeCandidate(bus, adapter.code));
      }
    }
  }

  const clusters = resolveBuses(candidates);
  const pricingContext = await createPricingContext({
    dsaId: context.dsaId || null,
    serviceCode: 'bus',
  });
  const buses = consolidateBusOffers(clusters, pricingContext).sort(
    (a, b) => (a.lowestPrice?.amount || 0) - (b.lowestPrice?.amount || 0),
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
      'All suppliers failed for this bus search',
      { httpStatus: 502, details: supplierMeta },
    );
  }

  await ensureBusSuppliers();

  const payload = {
    searchId: aplSearchId,
    status,
    origin: criteria.origin,
    destination: criteria.destination,
    travelDate: criteria.travelDate,
    passengers: { adults: criteria.adults, children: criteria.children },
    buses,
    suppliers: supplierMeta,
  };

  await Search.create({
    aplSearchId,
    type: 'BUS',
    status,
    dsaId: context.dsaId || undefined,
    requestId: context.requestId || undefined,
    request: criteria,
    results: payload,
    resultCount: buses.length,
    supplierResults: supplierMeta.map((m) => ({
      supplierCode: m.supplier,
      status: m.status,
      durationMs: m.durationMs,
      errorCode: m.errorCode,
      errorMessage: m.errorMessage,
      rawResultCount: m.rawResultCount,
    })),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  await logSupplierOutcomes({
    requestId: context.requestId,
    dsaId: context.dsaId,
    userId: context.userId,
    service: 'BUS',
    operation: 'searchBuses',
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
    service: 'BUS',
    operation: 'searchBuses',
    searchId: aplSearchId,
    status: status === 'COMPLETED' ? 'SUCCESS' : 'PARTIAL',
    result: {
      searchId: aplSearchId,
      status,
      busCount: buses.length,
      suppliers: supplierMeta,
    },
  });

  return payload;
}

async function getBusDetails(dto, context = {}) {
  const search = await getSearchOrThrow(dto.searchId);
  assertSearchTenantMatch(search, context.tenant);
  const bus = findBusInResults(search.results, dto.aplBusId);
  if (!bus) throw AppError.notFound(`Bus not found: ${dto.aplBusId}`);
  const offer = findOfferOnBus(bus, dto.aplOfferId);
  if (!offer) throw AppError.notFound('Bus offer not found');

  return {
    searchId: dto.searchId,
    aplBusId: bus.aplBusId,
    bus,
    selectedOffer: offer,
    seatInventory: buildSeatInventory(bus, offer),
    boardingPoints: offer.boardingPoints || [],
    droppingPoints: offer.droppingPoints || [],
    mockNote:
      'Seat layout and points are mock/deterministic for Phase 14A — not a real operator API.',
  };
}

async function revalidateBusOffer(dto, context = {}) {
  const search = await getSearchOrThrow(dto.searchId);
  assertSearchTenantMatch(search, context.tenant);
  const bus = findBusInResults(search.results, dto.aplBusId);
  if (!bus) {
    throw AppError.validation('Selected bus is no longer available. Search again.');
  }
  const offer = findOfferOnBus(bus, dto.aplOfferId);
  if (!offer) {
    throw AppError.validation('Selected bus offer is no longer available.');
  }
  if ((offer.seatsLeft || 0) < 1) {
    throw AppError.validation('No seats left on this offer.');
  }

  // Re-price from stored supplierPrice using current rules for revalidation,
  // but checkout will recompute again and snapshot at confirm time.
  const pricingContext = await createPricingContext({
    dsaId: context.tenant?.dsaId || search.dsaId || null,
    serviceCode: 'bus',
  });
  const { calculatePrice } = require('../../pricing/services/pricing-engine.service');
  const priced = calculatePrice({
    supplierPrice: offer.supplierPrice || {
      amount: offer.price?.amount,
      currency: offer.price?.currency,
    },
    supplierCode: offer.supplier,
    context: pricingContext,
    includeInternal: true,
  });

  return {
    ok: true,
    searchId: dto.searchId,
    aplBusId: bus.aplBusId,
    aplOfferId: offer.aplOfferId,
    price: priced.customerPrice,
    seatsLeft: offer.seatsLeft,
    commercialSnapshot: priced.commercialSnapshot,
  };
}

module.exports = {
  searchBuses,
  getBusDetails,
  revalidateBusOffer,
  sanitizeBusSearchForPublic,
  searchAplBusLocations,
  findBusInResults,
  findOfferOnBus,
  getSearchOrThrow,
  buildSeatInventory,
};
