'use strict';

const { AppError } = require('../../common/errors/app-error');
const { readAdminToken } = require('../../admin-auth/middleware/read-admin-token');
const {
  resolveAplAdminFromToken,
  toPublicAplAdmin,
} = require('../services/apl-auth.service');

async function requireAplAdmin(req, _res, next) {
  try {
    const token = readAdminToken(req);
    if (!token) {
      throw AppError.unauthorized(
        'Admin token is required. Send Authorization: Bearer <token>',
      );
    }
    const { user, role, session } = await resolveAplAdminFromToken(token);
    req.admin = {
      id: String(user._id),
      type: 'APL',
      user,
      role,
      permissions: new Set(role.permissions || []),
      public: toPublicAplAdmin(user, role),
    };
    req.adminToken = token;
    req.adminSession = session;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAplAdmin };
