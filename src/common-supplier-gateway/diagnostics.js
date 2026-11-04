'use strict';

const { redact } = require('../common/utils/redact');
const { encryptJson, decryptJson } = require('./crypto');

function gatewayDiagnostic({ requestId, supplierCode, payload }) {
  return {
    requestId: requestId || '',
    supplierCode: supplierCode || '',
    payload: redact(payload || {}),
  };
}

function rotateCredential(doc, previousKey, nextKey) {
  const secrets = decryptJson(doc, previousKey);
  return encryptJson(secrets, nextKey);
}

module.exports = { gatewayDiagnostic, rotateCredential };
