'use strict';

const crypto = require('crypto');
const { config } = require('../../common/config');
const { AppError, ErrorCode } = require('../../common/errors/app-error');
const { formatAplSearchId } = require('../../common/utils/apl-ids');
const { normalizeCandidate } = require('../utils/transfer-normalization');
const { resolveTransfers } = require('../utils/transfer-entity-resolution');
const {
  consolidateTransferOffers,
  sanitizeTransferSearchForPublic,
} = require('../utils/offer-consolidation');
const { createPricingContext } = require('../../pricing/services/pricing-engine.service');
const Supplier = require('../../common/database/models/Supplier');
const Service = require('../../tenant/models/Service');
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
const { searchAplTransferLocations } = require('./location.service');

async function ensureTransferActive() {
  await Service.findOneAndUpdate(
    { code: 'transfer' },
    {
      $set: {
        name: 'Transfer',
        slug: 'transfer',
        description: 'Airport and city transfers',
        icon: 'transfer',
        globalStatus: 'ACTIVE',
        displayOrder: 40,
      },
      $setOnInsert: { code: 'transfer' },
    },
    { upsert: true, new: true },
  );
}

async function ensureTransferSuppliers() {
  for (const code of ['MOCKXFER_A', 'MOCKXFER_B']) {
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
  const search = await Search.findOne({
    aplSearchId: searchId,
    type: 'TRANSFER',
  });
  if (!search) throw AppError.notFound(`Transfer search not found: ${searchId}`);
  if (search.expiresAt && search.expiresAt < new Date()) {
    throw AppError.validation('Search has expired. Please search again.');
  }
  return search;
}

function findTransferInResults(results, aplTransferId) {
  return (results?.transfers || []).find((t) => t.aplTransferId === aplTransferId) || null;
}

function findOfferOnTransfer(transfer, aplOfferId) {
  if (!transfer?.offers?.length) return null;
  if (aplOfferId) {
    return transfer.offers.find((o) => o.aplOfferId === aplOfferId) || null;
  }
  return transfer.primaryOffer || transfer.offers[0] || null;
}

async function searchTransfers(dto, forcedFailureList, context = {}) {
  await ensureTransferActive();
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
    service: 'TRANSFER',
    operation: 'searchTransfers',
    searchId: aplSearchId,
    status: 'SUCCESS',
    request: criteria,
  });

  const plan = await buildSupplierExecutionPlan({
    dsaId: context.dsaId,
    serviceCode: 'transfer',
    operation: 'searchTransfers',
  });

  const adapterContext = {
    requestId: context.requestId,
    dsaId: context.dsaId,
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

        const outcome = await adapter.searchTransfers(criteria, {
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
            transfers: [],
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
      rawResultCount: (outcome.transfers || []).length,
    });
    if (outcome.status === 'SUCCESS') {
      for (const row of outcome.transfers || []) {
        candidates.push(normalizeCandidate(row, adapter.code));
      }
    }
  }

  const clusters = resolveTransfers(candidates);
  const pricingContext = await createPricingContext({
    dsaId: context.dsaId || null,
    serviceCode: 'transfer',
  });
  const transfers = consolidateTransferOffers(clusters, pricingContext).sort(
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
      'All suppliers failed for this transfer search',
      { httpStatus: 502, details: supplierMeta },
    );
  }

  await ensureTransferSuppliers();

  const payload = {
    searchId: aplSearchId,
    status,
    pickup: criteria.pickup,
    dropoff: criteria.dropoff,
    pickupDateTime: criteria.pickupDateTime,
    passengers: criteria.passengers,
    transferType: criteria.transferType,
    transfers,
    suppliers: supplierMeta,
  };

  await Search.create({
    aplSearchId,
    type: 'TRANSFER',
    status,
    dsaId: context.dsaId || undefined,
    requestId: context.requestId || undefined,
    request: criteria,
    results: payload,
    resultCount: transfers.length,
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
    service: 'TRANSFER',
    operation: 'searchTransfers',
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
    service: 'TRANSFER',
    operation: 'searchTransfers',
    searchId: aplSearchId,
    status: status === 'COMPLETED' ? 'SUCCESS' : 'PARTIAL',
    result: {
      transferCount: transfers.length,
      suppliers: supplierMeta,
    },
  });

  return payload;
}

async function getTransferDetails(dto, context = {}) {
  const search = await getSearchOrThrow(dto.searchId);
  assertSearchTenantMatch(search, context.tenant);
  const transfer = findTransferInResults(search.results, dto.aplTransferId);
  if (!transfer) throw AppError.notFound(`Transfer not found: ${dto.aplTransferId}`);
  const offer = findOfferOnTransfer(transfer, dto.aplOfferId);
  if (!offer) throw AppError.notFound('Transfer offer not found');
  return {
    searchId: dto.searchId,
    aplTransferId: transfer.aplTransferId,
    transfer,
    selectedOffer: offer,
  };
}

async function revalidateTransferOffer(dto, context = {}) {
  const search = await getSearchOrThrow(dto.searchId);
  assertSearchTenantMatch(search, context.tenant);
  const transfer = findTransferInResults(search.results, dto.aplTransferId);
  if (!transfer) {
    throw AppError.validation(
      'Selected transfer is no longer available. Search again.',
    );
  }
  const offer = findOfferOnTransfer(transfer, dto.aplOfferId);
  if (!offer) {
    throw AppError.validation('Selected transfer offer is no longer available.');
  }

  const pricingContext = await createPricingContext({
    dsaId: context.tenant?.dsaId || search.dsaId || null,
    serviceCode: 'transfer',
  });
  // Re-price from stored supplierAmount if present in commercialSnapshot internals —
  // public offer has only customer price; use offer.price as authoritative for mock revalidation.
  const amount = Number(offer.price?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw AppError.validation('Transfer offer price is no longer valid.');
  }

  return {
    valid: true,
    searchId: dto.searchId,
    aplTransferId: transfer.aplTransferId,
    aplOfferId: offer.aplOfferId,
    price: offer.price,
    pricingVersion: pricingContext.pricingVersion || '12.0',
  };
}

module.exports = {
  searchTransfers,
  getTransferDetails,
  revalidateTransferOffer,
  sanitizeTransferSearchForPublic,
  searchAplTransferLocations,
  findOfferOnTransfer,
  ensureTransferActive,
  ensureTransferSuppliers,
};
