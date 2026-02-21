'use strict';

// PHASE 1 — MOVED: Pure bootstrap - process startup only
// Express app configuration moved to app.js
// WebSocket bootstrap remains in websocket/index.js

require('./config/env');
require('./config/cookieConfig'); // Log effective cookie settings in dev

const http = require('http');
const net = require('net');
const config = require('./config/constants');
const app = require('./app');
const { attachWebSocketServer } = require('./websocket');
const redisBus = require('./services/redisBus');
const { createOnChatMessage, createOnAdminKick } = require('./services/redisBusHandlers');
const logger = require('./utils/logger');
const roomManager = require('./websocket/state/roomManager');
const userService = require('./services/user.service');
const userStoreStorage = require('./storage/user.mongo');

async function findAvailablePort(preferred, maxPort = 3010) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const portProbe = net
        .createServer()
        .once('error', (err) => {
          if (err.code === 'EADDRINUSE' && port < maxPort) {
            return tryPort(port + 1);
          }
          resolve(preferred); // fall back to preferred if unexpected error or no more room
        })
        .once('listening', () => {
          portProbe.close(() => resolve(port));
        })
        .listen(port, '0.0.0.0');
    };
    tryPort(preferred);
  });
}

async function start() {
  const port = await findAvailablePort(config.PORT);

  await roomManager.loadFromStore();
  await userService.ensureRootAdmin();
  await userService.ensureDevAdminUser();

  // Create HTTP server from Express app
  const server = http.createServer(app);

  // Attach WebSocket server (PHASE 1 — MOVED from app.js). Path from env (required in prod).
  const wsPath = process.env.WS_PATH || '/ws';
  const wsCore = attachWebSocketServer(server, { path: wsPath });

  // Redis bus: connect + subscribe; real handlers deliver/kick on local sockets
  const localInstanceId = redisBus.getInstanceId();
  await redisBus.startRedisBus({
    onChatMessage: createOnChatMessage({ instanceId: localInstanceId }),
    onAdminKick: createOnAdminKick({ instanceId: localInstanceId }),
  });

  server.listen(port, () => {
    const snapshotWriter = require('./observability/snapshotWriter');
    snapshotWriter.start();
    console.log(`Backend listening on http://localhost:${port}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`DEV: ws path=/ws. Frontend VITE_BACKEND_PORT should match PORT (default 8000).`);
    }
  });

  function handleShutdown(signal) {
    (async () => {
      let exitCode = 0;
      try {
        const snapshotWriter = require('./observability/snapshotWriter');
        snapshotWriter.stop();
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
