'use strict';

const { Types } = require('mongoose');
const { AppError } = require('../../common/errors/app-error');
const ServiceLog = require('../../common/database/models/ServiceLog');
const SupplierRawPayload = require('../../common/database/models/SupplierRawPayload');
const Dsa = require('../../tenant/models/Dsa');
const { redact } = require('../../common/utils/redact');

function assertObjectId(value, field) {
  if (!Types.ObjectId.isValid(value)) {
    throw AppError.validation(`Invalid ${field}`, [{ field, value }]);
  }
  return value;
}

async function searchRequestLogs({
  requestId,
  dsaId,
  service,
  operation,
  supplier,
  status,
  stage,
  from,
  to,
  page = 1,
  pageSize = 30,
} = {}) {
  const filter = {};
  if (requestId) filter.requestId = String(requestId).trim();
  if (dsaId) {
    assertObjectId(dsaId, 'dsaId');
    filter.dsaId = dsaId;
  }
  if (service) filter.service = String(service).trim().toUpperCase();
  if (operation) {
    filter.operation = new RegExp(
      String(operation).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i',
    );
  }
  if (supplier) filter.supplierCode = String(supplier).trim().toUpperCase();
  if (status) filter.status = String(status).trim().toUpperCase();
  if (stage) filter.stage = String(stage).trim().toUpperCase();
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 30));

  // Group by requestId for list view — take latest inbound-ish rows as anchors.
  const pipeline = [
    { $match: filter },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$requestId',
        lastAt: { $first: '$createdAt' },
        dsaId: { $first: '$dsaId' },
        service: { $first: '$service' },
        operation: { $first: '$operation' },
        status: { $first: '$status' },
        stages: { $addToSet: '$stage' },
        suppliers: { $addToSet: '$supplierCode' },
        count: { $sum: 1 },
      },
    },
    { $sort: { lastAt: -1 } },
    {
      $facet: {
        items: [
          { $skip: (safePage - 1) * safeSize },
          { $limit: safeSize },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];

  const [agg] = await ServiceLog.aggregate(pipeline);
  const items = agg?.items || [];
  const total = agg?.total?.[0]?.count || 0;
  const dsaIds = [...new Set(items.map((i) => String(i.dsaId || '')).filter(Boolean))];
  const dsas = dsaIds.length
    ? await Dsa.find({ _id: { $in: dsaIds } }).select('dsaCode displayName').lean()
    : [];
  const dsaBy = new Map(dsas.map((d) => [String(d._id), d]));

  return {
    items: items.map((row) => ({
      requestId: row._id,
      dsaId: row.dsaId ? String(row.dsaId) : null,
      dsaCode: row.dsaId ? dsaBy.get(String(row.dsaId))?.dsaCode || null : null,
      dsaName: row.dsaId ? dsaBy.get(String(row.dsaId))?.displayName || null : null,
      service: row.service,
      operation: row.operation,
      status: row.status || null,
      stages: (row.stages || []).filter(Boolean),
      suppliers: (row.suppliers || []).filter(Boolean),
      eventCount: row.count,
      lastAt: row.lastAt,
    })),
    pagination: {
      page: safePage,
      pageSize: safeSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / safeSize) || 1),
    },
  };
}

async function getRequestLifecycle(requestId) {
  const id = String(requestId || '').trim();
  if (!id) throw AppError.validation('requestId is required');

  const events = await ServiceLog.find({ requestId: id })
    .sort({ createdAt: 1 })
    .lean();
  if (!events.length) throw AppError.notFound('Request not found');

  const payloadIds = events
    .map((e) => e.payloadRef)
    .filter(Boolean);
  const payloads = payloadIds.length
    ? await SupplierRawPayload.find({ _id: { $in: payloadIds } }).lean()
    : [];
  const payloadById = new Map(payloads.map((p) => [String(p._id), p]));

  let dsa = null;
  if (events[0].dsaId) {
    dsa = await Dsa.findById(events[0].dsaId).select('dsaCode displayName').lean();
  }

  const timeline = events.map((e) => {
    const raw = e.payloadRef ? payloadById.get(String(e.payloadRef)) : null;
    return {
      id: String(e._id),
      at: e.createdAt,
      stage: e.stage || null,
      direction: e.direction,
      service: e.service,
      operation: e.operation,
      supplierCode: e.supplierCode || null,
      supplierId: e.supplierId ? String(e.supplierId) : null,
      searchId: e.searchId || null,
      status: e.status || null,
      httpStatus: e.httpStatus,
      durationMs: e.durationMs,
      errorCode: e.errorCode || null,
      errorMessage: e.errorMessage || null,
      request: redact(e.request),
      supplierRequest: redact(e.supplierRequest),
      result: redact(e.result),
      payload: raw
        ? {
            id: String(raw._id),
            truncated: Boolean(raw.truncated),
            byteLength: raw.byteLength,
            stage: raw.stage,
            data: redact(raw.payload),
          }
        : null,
    };
  });

  const branches = {};
  for (const event of timeline) {
    if (!event.supplierCode) continue;
    if (!branches[event.supplierCode]) branches[event.supplierCode] = [];
    branches[event.supplierCode].push(event);
  }

  return {
    requestId: id,
    dsa: dsa
      ? { id: String(dsa._id), dsaCode: dsa.dsaCode, displayName: dsa.displayName }
      : null,
    service: events.find((e) => e.service)?.service || null,
    timeline,
    branches,
  };
}

module.exports = {
  searchRequestLogs,
  getRequestLifecycle,
};
