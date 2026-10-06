'use strict';

const Dsa = require('../../tenant/models/Dsa');
const Service = require('../../tenant/models/Service');
const DsaService = require('../../tenant/models/DsaService');
const { toPublicDsa } = require('../../tenant/services/dsa.service');

async function getAplAdminDashboard() {
  const [
    totalDsas,
    activeDsas,
    suspendedDsas,
    archivedDsas,
    totalServices,
    activeServices,
    recentDsas,
    assignmentAgg,
  ] = await Promise.all([
    Dsa.countDocuments({}),
    Dsa.countDocuments({ status: 'ACTIVE' }),
    Dsa.countDocuments({ status: 'SUSPENDED' }),
    Dsa.countDocuments({ status: 'ARCHIVED' }),
    Service.countDocuments({}),
    Service.countDocuments({ globalStatus: 'ACTIVE' }),
    Dsa.find({}).sort({ createdAt: -1 }).limit(8).lean(),
    DsaService.aggregate([
      { $match: { isAllowedByAPL: true } },
      {
        $lookup: {
          from: 'services',
          localField: 'serviceId',
          foreignField: '_id',
          as: 'service',
        },
      },
      { $unwind: '$service' },
      {
        $group: {
          _id: '$service.code',
          name: { $first: '$service.name' },
          allowedDsaCount: { $sum: 1 },
          globalStatus: { $first: '$service.globalStatus' },
          displayOrder: { $first: '$service.displayOrder' },
        },
      },
      { $sort: { displayOrder: 1, name: 1 } },
    ]),
  ]);

  const recentIds = recentDsas.map((d) => d._id);
  const recentAllowed = await DsaService.aggregate([
    {
      $match: {
        dsaId: { $in: recentIds },
        isAllowedByAPL: true,
      },
    },
    { $group: { _id: '$dsaId', count: { $sum: 1 } } },
  ]);
  const countByDsa = new Map(
    recentAllowed.map((row) => [String(row._id), row.count]),
  );

  return {
    stats: {
      totalDsas,
      activeDsas,
      suspendedDsas,
      archivedDsas,
      totalServices,
      activeServices,
    },
    recentDsas: recentDsas.map((dsa) =>
      toPublicDsa(dsa, {
        allowedServiceCount: countByDsa.get(String(dsa._id)) || 0,
      }),
    ),
    serviceAssignmentOverview: assignmentAgg.map((row) => ({
      code: row._id,
      name: row.name,
      allowedDsaCount: row.allowedDsaCount,
      globalStatus: row.globalStatus,
    })),
  };
}

module.exports = { getAplAdminDashboard };
