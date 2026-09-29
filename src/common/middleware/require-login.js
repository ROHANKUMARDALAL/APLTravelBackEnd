'use strict';

const { AppError } = require('../errors/app-error');
const { userFromLoginToken } = require('../../user/services/auth.service');

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
