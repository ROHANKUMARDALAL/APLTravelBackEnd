'use strict';

const {
  loginAplAdmin,
  logoutAplAdmin,
} = require('../services/apl-auth.service');
const { readAdminToken } = require('../../admin-auth/middleware/read-admin-token');
const { sendSuccess } = require('../../common/response/envelope');

async function login(req, res) {
  const result = await loginAplAdmin({
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
  const result = await logoutAplAdmin(token);
  return sendSuccess(res, result);
}

async function me(req, res) {
  return sendSuccess(res, { user: req.admin.public });
}

module.exports = { login, logout, me };
