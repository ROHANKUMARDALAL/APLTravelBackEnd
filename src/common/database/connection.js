'use strict';

const mongoose = require('mongoose');
const { config } = require('../config');

async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongodbUri);
  console.log('Connected to MongoDB');
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

async function isDatabaseHealthy() {
  try {
    if (mongoose.connection.readyState !== 1) return false;
    await mongoose.connection.db.admin().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  isDatabaseHealthy,
  mongoose,
};
