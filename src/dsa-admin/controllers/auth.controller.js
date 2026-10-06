'use strict';

const {
  loginDsaAdmin,
  logoutDsaAdmin,
} = require('../services/dsa-auth.service');
const { readAdminToken } = require('../../admin-auth/middleware/read-admin-token');
const { sendSuccess } = require('../../common/response/envelope');
const { getTenantContext } = require('../../tenant/middleware/tenant-context');

async function login(req, res) {
  const result = await loginDsaAdmin({
    email: req.body?.email,
    password: req.body?.password,
  });
  return sendSuccess(res, {
    token: result.token,
    expiresAt: result.expiresAt,
    user: result.user,
  });
}

async function logout(req, res) {
  const token = readAdminToken(req) || req.adminToken;
  const result = await logoutDsaAdmin(token);
  return sendSuccess(res, result);
}

async function me(req, res) {
  return sendSuccess(res, {
    user: req.admin.public,
    tenant: getTenantContext(req),
  });
}

module.exports = { login, logout, me };
