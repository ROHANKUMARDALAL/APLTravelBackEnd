'use strict';

const { sendSuccess } = require('../../common/response/envelope');
const { getAplAdminDashboard } = require('../services/dashboard.service');

async function getDashboard(_req, res) {
  const data = await getAplAdminDashboard();
  return sendSuccess(res, data);
}

module.exports = { getDashboard };
