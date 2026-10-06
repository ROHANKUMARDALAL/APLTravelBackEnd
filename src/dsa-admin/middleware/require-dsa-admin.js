'use strict';

const { AppError } = require('../../common/errors/app-error');
const { readAdminToken } = require('../../admin-auth/middleware/read-admin-token');
const { attachTenantContext } = require('../../tenant/middleware/tenant-context');
const {
  resolveDsaAdminFromToken,
  toPublicDsaAdmin,
} = require('../services/dsa-auth.service');

/**
 * Authenticate DSAAdmin and attach trusted tenant context from the session.
 * Client-supplied dsaId in body/query is ignored for tenant identity.
 */
async function requireDsaAdmin(req, _res, next) {
  try {
    const token = readAdminToken(req);
    if (!token) {
      throw AppError.unauthorized(
        'Admin token is required. Send Authorization: Bearer <token>',
      );
    }
    const { user, role, session, dsa } = await resolveDsaAdminFromToken(token);

    req.admin = {
      id: String(user._id),
      type: 'DSA',
      user,
      role,
      permissions: new Set(role.permissions || []),
      public: toPublicDsaAdmin(user, role, dsa),
    };
    req.adminToken = token;
    req.adminSession = session;

    attachTenantContext(req, {
      dsaId: String(session.dsaId),
      dsaCode: dsa.dsaCode,
      source: 'session',
    });

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireDsaAdmin };
