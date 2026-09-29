'use strict';

const { config } = require('./common/config');
const { connectDatabase } = require('./common/database/connection');
const { createApp } = require('./app');

async function bootstrap() {
  await connectDatabase();
  const app = createApp();

  app.listen(config.port, () => {
    console.log(
      `APL Travel backend listening on http://localhost:${config.port} (prefix=/${config.apiPrefix})`,
    );
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
