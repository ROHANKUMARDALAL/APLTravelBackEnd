'use strict';

const express = require('express');
const { asyncHandler } = require('../../common/middleware/error-handler');
const { sendSuccess } = require('../../common/response/envelope');
const { listSupplierMeta } = require('../../hotel/suppliers/registry');
const { listFlightSupplierMeta } = require('../../flight/suppliers/registry');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, {
      suppliers: [
        ...listSupplierMeta().map((s) => ({ ...s, product: s.product || 'HOTEL' })),
        ...listFlightSupplierMeta(),
      ],
    });
  }),
);

module.exports = router;
