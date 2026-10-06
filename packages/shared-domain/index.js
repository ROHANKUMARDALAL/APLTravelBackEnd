'use strict';

/**
 * @apl/shared-domain
 *
 * Canonical enums, ownership/contracts, tenant authority helpers,
 * service-offer rule, and serialization guards for multi-backend readiness.
 *
 * Does NOT include Express controllers/routes or app-specific UI.
 * Mongoose model classes remain in APLTravelBackEnd until Phase 15E/F extraction;
 * this package is the versioned contract those models must honor.
 */

const constants = require('./constants');
const { isServiceOffered } = require('./rules/service-offer');
const tenant = require('./tenant/authority');
const security = require('./security/serialize');
const { OWNERSHIP } = require('./contracts/ownership');
const { CONTRACTS } = require('./contracts/required-fields');
const customerIdentity = require('./contracts/customer-identity');
const models = require('./models');

module.exports = {
  ...constants,
  isServiceOffered,
  tenant,
  security,
  OWNERSHIP,
  CONTRACTS,
  customerIdentity,
  models,
  PACKAGE_NAME: '@apl/shared-domain',
  PACKAGE_VERSION: '1.0.0',
};
