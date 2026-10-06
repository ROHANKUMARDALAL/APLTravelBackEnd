'use strict';

const { writeServiceLog, serviceFromPath } = require('../services/service-log.service');
const { writeLifecycleLog } = require('../services/lifecycle-log.service');

function serviceLogMiddleware(req, res, next) {
  const path = req.path || req.originalUrl || '';
  if (path === '/health' || path === '/ready' || path.startsWith('/health')) {
    return next();
  }
  const started = Date.now();
  const originalJson = res.json.bind(res);
  let responseBody;
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  // Capture inbound ASAP (before tenant middleware may attach dsaId — finish rewrite below).
  res.on('finish', () => {
    const error = responseBody?.error;
    const failed =
      res.statusCode >= 400 ||
      (error && error.errorCode && error.errorCode !== 0);
    const service = serviceFromPath(req.originalUrl || req.path);
    const operation = `${req.method} ${req.originalUrl}`;
    const common = {
      requestId: req.requestId,
      dsaId: req.tenant?.dsaId || undefined,
      userId: req.user?._id,
      service,
      operation,
      httpStatus: res.statusCode,
      durationMs: Date.now() - started,
      request: { query: req.query, body: req.body },
    };

    writeLifecycleLog({
      ...common,
      stage: 'INBOUND_REQUEST',
      direction: 'INBOUND',
      status: 'SUCCESS',
    });

    writeServiceLog({
      ...common,
      stage: failed ? 'ERROR' : 'OUTBOUND_RESPONSE',
      direction: 'INBOUND',
      status: failed ? 'FAILED' : 'SUCCESS',
      result: responseBody,
      errorCode: error && error.errorCode ? String(error.errorCode) : undefined,
      errorMessage:
        error && error.ErrorMessage ? error.ErrorMessage : undefined,
    });
  });

  next();
}

module.exports = { serviceLogMiddleware };
