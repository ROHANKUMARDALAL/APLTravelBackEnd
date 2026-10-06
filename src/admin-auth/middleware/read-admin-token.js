'use strict';

function readAdminToken(req) {
  const header = req.header('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const direct = req.header('x-admin-token');
  return direct ? String(direct).trim() : '';
}

module.exports = { readAdminToken };
