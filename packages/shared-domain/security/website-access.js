'use strict';

const crypto = require('crypto');

const TOKEN_PREFIX = 'dsa_web_';

function hashWebsiteToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function issueWebsiteToken() {
  const raw = `${TOKEN_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
  return {
    raw,
    tokenHash: hashWebsiteToken(raw),
    tokenPrefix: raw.slice(0, TOKEN_PREFIX.length + 4),
  };
}

function maskWebsiteToken(tokenPrefix) {
  if (!tokenPrefix) return '';
  return `${tokenPrefix}••••••••`;
}

function publicWebsiteAccess(access) {
  if (!access || !access.tokenPrefix) {
    return {
      status: 'NOT_ISSUED',
      tokenPrefix: '',
      maskedToken: '',
      createdAt: null,
      rotatedAt: null,
    };
  }
  return {
    status: access.status || 'ACTIVE',
    tokenPrefix: access.tokenPrefix,
    maskedToken: maskWebsiteToken(access.tokenPrefix),
    createdAt: access.createdAt || null,
    rotatedAt: access.rotatedAt || null,
  };
}

module.exports = {
  TOKEN_PREFIX,
  hashWebsiteToken,
  issueWebsiteToken,
  maskWebsiteToken,
  publicWebsiteAccess,
};
