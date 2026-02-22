'use strict';

require('./config/env');
require('./config/cookieConfig');

const http = require('http');
const config = require('./config/constants');
const app = require('./app');
console.log('trust proxy:', app.get('trust proxy'));

if (process.env.NODE_ENV === 'production') {
  const { getAllowlistSummary } = require('./config/origins');
  console.log('CORS allowlist:', getAllowlistSummary());
}
const { attachWebSocketServer } = require('./websocket');
const redisBus = require('./services/redisBus');
const { createOnChatMessage, createOnAdminKick } = require('./services/redisBusHandlers');
const roomManager = require('./websocket/state/roomManager');
const userService = require('./services/user.service');

// Readiness flag
let READY = false;

// Inject readiness route into Express before starting
app.get('/readyz', (req, res) => res.status(READY ? 200 : 503).send(READY ? 'ready' : 'not-ready'));

/**
 * Retry loop for Redis so the backend doesn't crash 
 * if Render's free Redis takes a while to wake up.
 */
async function startRedisWithRetry() {
  while (true) {
    try {
      const localInstanceId = redisBus.getInstanceId();
      await redisBus.startRedisBus({
        onChatMessage: createOnChatMessage({ instanceId: localInstanceId }),
        onAdminKick: createOnAdminKick({ instanceId: localInstanceId }),
      });
      console.log('Redis bus started successfully.');
      return;
    } catch (e) {
      console.error('Redis init failed, retrying in 5s:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function start() {
  // 1. Safe port coercion
  const port = Number(process.env.PORT || config.PORT || 10000);

  // 2. Create HTTP server from Express app
  const server = http.createServer(app);

  // 3. Attach WebSocket server
  const wsPath = process.env.WS_PATH || '/ws';
  const wsCore = attachWebSocketServer(server, { path: wsPath });

  // 4. Ensure root admin before accepting traffic (idempotent); fail fast in production
  const { ensureRootAdmin } = require('./auth/ensureRootAdmin');
  try {
    await ensureRootAdmin();
  } catch (err) {
    console.error('ensureRootAdmin failed:', err.message);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  // 5. 🔥 LISTEN FIRST 🔥 (Satisfies Render Port Scanner)
  server.listen(port, '0.0.0.0', () => {
    console.log(`Backend listening on 0.0.0.0:${port}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`DEV: ws path=${wsPath}. Frontend VITE_BACKEND_PORT should match PORT.`);
    }
  });

  // 6. SLOW INITIALIZATION WITH RETRY
  try {
    console.log('Starting background initialization (DB, Redis)...');
    
    await roomManager.loadFromStore();
    await userService.ensureDevAdminUser();

    // Start Redis with the robust retry loop
    await startRedisWithRetry();

    const snapshotWriter = require('./observability/snapshotWriter');
    snapshotWriter.start();
    
    // Mark as fully ready!
    READY = true;
    console.log('Background initialization complete. Server is READY.');
  } catch (error) {
    console.error('Fatal error during background initialization:', error);
  }

  // 7. Graceful Shutdown Handlers
  function handleShutdown(signal) {
    (async () => {
      let exitCode = 0;
      console.log(`Received ${signal}. Starting graceful shutdown...`);
      try {
        const snapshotWriter = require('./observability/snapshotWriter');
        if (snapshotWriter && typeof snapshotWriter.stop === 'function') {
           snapshotWriter.stop();
        }
        if (wsCore && typeof wsCore.shutdown === 'function') {
          await wsCore.shutdown();
        }

        await new Promise((resolve, reject) => {
          server.close((err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      } catch (error) {
        console.error('Error during shutdown:', error);
        exitCode = 1;
      } finally {
        try {
          await redisBus.stopRedisBus();
        } catch (_) {}
        process.exit(exitCode);
      }
    })();
  }

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

start();