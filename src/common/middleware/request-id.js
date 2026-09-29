'use strict';

const { v4: uuidv4 } = require('uuid');

function requestIdMiddleware(req, res, next) {
  const incoming = req.header('x-request-id');
  const requestId =
    incoming && incoming.trim().length > 0 ? incoming.trim() : uuidv4();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}

module.exports = { requestIdMiddleware };
