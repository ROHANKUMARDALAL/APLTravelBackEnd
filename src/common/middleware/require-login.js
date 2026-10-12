'use strict';

const { AppError } = require('../errors/app-error');
const { userFromLoginToken } = require('../../user/services/auth.service');
const { resolvePublicTenant } = require('../../public-site/services/resolve-tenant.service');
const { assertCustomerCanUseDsa } = require('../../customer/services/membership.service');

async function bindCustomerTenant(req, user) {
  try {
    const { dsa } = await resolvePublicTenant(req);
    req.customerMembership = await assertCustomerCanUseDsa({ userId: user._id, dsaId: dsa._id });
    req.customerDsaId = dsa._id;
  } catch (err) {
    const status = err.httpStatus || err.statusCode || err.status;
    if (status === 403) throw err;
  }
}

function readLoginToken(req) {
  const header = req.header('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const direct = req.header('x-login-token');
  return direct ? String(direct).trim() : '';
}

async function requireLogin(req, _res, next) {
  try {
    const token = readLoginToken(req);
    if (!token) {
      throw AppError.unauthorized(
        'Login token is required. Send Authorization: Bearer <loginToken>',
      );
    }
    const user = await userFromLoginToken(token);
    req.user = user;
    req.loginToken = token;
    await bindCustomerTenant(req, user);
    next();
  } catch (err) {
    next(err);
  }
}

/** Attach the user when a login token is sent. Search stays public without one. */
async function optionalLogin(req, _res, next) {
  const token = readLoginToken(req);
  if (!token) return next();
  try {
    req.user = await userFromLoginToken(token);
    req.loginToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireLogin, optionalLogin, readLoginToken };
