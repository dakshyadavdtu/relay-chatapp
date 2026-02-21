'use strict';

/**
 * Message metrics aggregator.
 * MPS = messages accepted and persisted only (not every WS packet).
 * totalMessages.received = messages_persisted_total, .sent = messages_delivered_total (observability/metrics).
 * messagesPerSecond = rate from persisted-message timestamps only (rolling 60s window).
 * NEVER throws - always returns safe defaults.
 */

// Rolling window for persisted messages per second (last 60 seconds). Only appended by trackPersistedMessageTimestamp().
const MPS_WINDOW_SIZE = 60;
const MPS_MAX_LENGTH = 6000; // Clamp to avoid unbounded growth
const messageTimestamps = [];

/**
 * Get messages summary
 * @param {Object} state - State object (may be undefined/null)
 * @returns {Object} Message metrics (always safe, never throws)
 */
function getMessagesSummary(state) {
  try {
    const metricsModule = require('../../observability/metrics');
    let metrics = null;
    try {
      metrics = metricsModule.getMetrics();
    } catch {
      metrics = {};
    }

    const currentReceived = typeof metrics.messages_persisted_total === 'number' ? metrics.messages_persisted_total : 0;
    const currentSent = typeof metrics.messages_delivered_total === 'number' ? metrics.messages_delivered_total : 0;

    // MPS from persisted-message timestamps only (bounded ring). We expose both MPS and last-minute count
    // so the dashboard never looks "dead": rolling MPS can be ~0 while messages in last 60s is still visible.
    let messagesPerSecond = 0;
    let recentCount = 0;
    try {
      const now = Date.now();
      const cutoff = now - (MPS_WINDOW_SIZE * 1000);
      const recentMessages = Array.isArray(messageTimestamps)
        ? messageTimestamps.filter(ts => typeof ts === 'number' && ts >= cutoff)
        : [];
      recentCount = recentMessages.length;
      messagesPerSecond = recentCount / MPS_WINDOW_SIZE;
    } catch {
      messagesPerSecond = 0;
      recentCount = 0;
    }

    return {
      totalMessages: {
        received: currentReceived,
        sent: currentSent,
      },
      messagesPerSecond: Math.round(messagesPerSecond * 100) / 100,
      messagesLastMinute: recentCount,
    };
  } catch {
    return {
      totalMessages: { received: 0, sent: 0 },
      messagesPerSecond: 0,
      messagesLastMinute: 0,
    };
  }
}

/**
 * Push a timestamp into the MPS rolling window (internal). Used by trackPersistedMessageTimestamp.
 */
function _trackMessageTimestamp() {
  try {
    if (!Array.isArray(messageTimestamps)) return;
    const now = typeof Date.now === 'function' ? Date.now() : 0;
    messageTimestamps.push(now);
    const cutoff = now - (MPS_WINDOW_SIZE * 1000);
    while (messageTimestamps.length > 0 && messageTimestamps[0] < cutoff) {
      messageTimestamps.shift();
    }
    while (messageTimestamps.length > MPS_MAX_LENGTH) {
      messageTimestamps.shift();
    }
  } catch {
    // no-op
  }
}

/**
 * Call when a message is accepted and persisted. Public, safe, never throws.
 * Only this should feed the MPS window (called from message.service after metrics.increment('messages_persisted_total')).
 */
function trackPersistedMessageTimestamp(callerLabel) {
  try {
    _trackMessageTimestamp();
  } catch (_) {
    // no-op
  }
}

/**
 * Reset the MPS timestamp window. For unit tests only; do not use in production.
 */
function _resetForTest() {
  try {
    if (Array.isArray(messageTimestamps)) messageTimestamps.length = 0;
  } catch (_) {
    // no-op
  }
}

module.exports = {
  getMessagesSummary,
  _trackMessageTimestamp,
  trackPersistedMessageTimestamp,
  _resetForTest,
};
