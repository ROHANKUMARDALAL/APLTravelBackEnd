'use strict';

const { DsaStatus } = require('../constants/tenant');

/**
 * Canonical service-offer rule (field-level authority preserved):
 *   offered =
 *     Service.globalStatus === ACTIVE
 *     AND Dsa.status === ACTIVE
 *     AND DsaService.isAllowedByAPL === true   (APLAdmin-writable)
 *     AND DsaService.isActiveByDSA === true    (DSAAdmin-writable)
 *
 * B2C and all admin surfaces MUST use this pure function (or a thin DB wrapper
 * that delegates here). Do not reimplement independently in extracted backends.
 */
function isServiceOffered({ dsa, service, mapping }) {
  if (!dsa || !service || !mapping) return false;
  return (
    String(service.globalStatus).toUpperCase() === 'ACTIVE' &&
    String(dsa.status).toUpperCase() === DsaStatus.ACTIVE &&
    mapping.isAllowedByAPL === true &&
    mapping.isActiveByDSA === true
  );
}

module.exports = { isServiceOffered };
