'use strict';

/**
 * Tier-3: WebSocket reconnect resync flow.
 * Runs state sync and message replay in one go (e.g. for server-driven resync or tests).
 * Normal flow: client sends STATE_SYNC then MESSAGE_REPLAY separately; this module allows one-shot resync.
 */

const offlineSync = require('./offline/offline.sync');

/**
 * Run full resync for a reconnected client: state sync + replay.
 * Order: state sync first (so client knows undelivered count), then replay.
 * @param {WebSocket} ws - Client WebSocket (authenticated)
 * @param {Object} options - { lastMessageId?, lastReadMessageId?, replayLimit? }
 * @returns {Promise<{ stateSync: Object, replay: Object }>}
 */
async function runResync(ws, options = {}) {
  const { lastMessageId, lastReadMessageId, replayLimit } = options;
  const stateSync = await offlineSync.runStateSync(ws, {
    lastMessageId: lastMessageId ?? undefined,
    lastReadMessageId: lastReadMessageId ?? undefined,
  });
  const replay = await offlineSync.runReplay(ws, {
    lastMessageId: lastMessageId ?? undefined,
    limit: replayLimit,
  });
  return { stateSync, replay };
}

module.exports = {
  runResync,
};
