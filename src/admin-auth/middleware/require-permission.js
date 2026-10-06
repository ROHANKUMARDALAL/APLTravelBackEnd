'use strict';

const { AppError } = require('../../common/errors/app-error');
const { hasPermission, hasAnyPermission } = require('../permissions');

/**
 * Permission gate. Requires prior requireAplAdmin / requireDsaAdmin
 * which attach req.admin.permissions (Set or array).
 * Array argument means ALL listed permissions are required.
 */
function requirePermission(required) {
  return function permissionMiddleware(req, _res, next) {
    try {
      const permissions = req.admin?.permissions;
      if (!permissions) {
        throw AppError.unauthorized('Admin authentication is required');
      }
      if (!hasPermission(permissions, required)) {
        throw AppError.forbidden('Permission denied');
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Array argument means ANY listed permission is sufficient. */
function requireAnyPermission(candidates) {
  return function anyPermissionMiddleware(req, _res, next) {
    try {
      const permissions = req.admin?.permissions;
      if (!permissions) {
        throw AppError.unauthorized('Admin authentication is required');
      }
      if (!hasAnyPermission(permissions, candidates)) {
        throw AppError.forbidden('Permission denied');
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requirePermission, requireAnyPermission };
