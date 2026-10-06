'use strict';

/**
 * Canonical Mongoose models for shared MongoDB collections.
 * Backends must require these (or thin re-exports) — do not fork schemas.
 */
module.exports = {
  Dsa: require('./Dsa'),
  Service: require('./Service'),
  DsaService: require('./DsaService'),
};
