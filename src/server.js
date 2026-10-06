'use strict';

const { config } = require('./common/config');
const {
  connectDatabase,
  disconnectDatabase,
} = require('./common/database/connection');
const { createApp } = require('./app');
const {
  markDatabaseConnected,
  markInitComplete,
  markHttpListening,
} = require('./common/readiness/state');

let server;

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down APL Travel backend…`);
  markHttpListening(false);
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
  } catch (err) {
    console.error('HTTP close error:', err);
  }
  try {
    await disconnectDatabase();
    markDatabaseConnected(false);
  } catch (err) {
    console.error('Mongo disconnect error:', err);
  }
  process.exit(0);
}

async function bootstrap() {
  await connectDatabase();
  markDatabaseConnected(true);
  markInitComplete(true);

  const app = createApp();
  server = await new Promise((resolve, reject) => {
    const s = app.listen(config.port, () => {
      markHttpListening(true);
      console.log(
        `APL Travel backend listening on http://localhost:${config.port} (prefix=/${config.apiPrefix})`,
      );
      console.log(
        `Probes: GET /health (liveness) · GET /ready (dependency readiness)`,
      );
      resolve(s);
    });
    s.on('error', reject);
  });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  markDatabaseConnected(false, err?.message || err);
  markInitComplete(false);
  markHttpListening(false);
  console.error('Failed to start server:', err);
  process.exit(1);
});
