'use strict';

const { writeServiceLog, serviceFromPath } = require('../services/service-log.service');

function serviceLogMiddleware(req, res, next) {
  const started = Date.now();
  const originalJson = res.json.bind(res);
  let responseBody;
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const error = responseBody?.error;
    writeServiceLog({
      direction: 'INBOUND',
      requestId: req.requestId,
      userId: req.user?._id,
      service: serviceFromPath(req.originalUrl || req.path),
      operation: `${req.method} ${req.originalUrl}`,
      httpStatus: res.statusCode,
      durationMs: Date.now() - started,
      request: { query: req.query, body: req.body },
      result: responseBody,
      errorCode: error && error.errorCode ? String(error.errorCode) : undefined,
      errorMessage:
        error && error.errorCode && error.errorCode !== 0 ? error.ErrorMessage : undefined,
    });
  });

  next();
}

module.exports = { serviceLogMiddleware };
