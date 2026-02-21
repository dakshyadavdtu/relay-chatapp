'use strict';

// MOVED IN PHASE 3 — NO LOGIC CHANGE: index.js is coordinator only; connect/disconnect/heartbeat delegated to connection/lifecycle.js and connection/presence.js via wsServer and connectionManager.
const { createWebSocketServer, handleUpgrade, shutdown } = require('./connection/wsServer');
const connectionManager = require('./connection/connectionManager');
const socketSafety = require('./safety/socketSafety');
const roomManager = require('./state/roomManager');
const presenceEngine = require('./handlers/presence');
const messageEngine = require('./handlers/messageEngine');
const roomEngine = require('./handlers/room');
const redisAdapter = require('../services/redisAdapter');
const monitoring = require('../utils/monitoring');
const logger = require('../utils/logger');
const config = require('../config/constants');
const ErrorCodes = require('../utils/errorCodes');
// Tier-3: Offline & History
const historyService = require('../services/history.service');
const historyController = require('../http/controllers/history.controller');

/**
 * WebSocket server instance
 * @type {WebSocketServer|null}
 */
let wss = null;

/**
 * Attach WebSocket server to an existing HTTP server
 * 
 * @param {http.Server} httpServer - Node.js HTTP server (from Express)
 * @param {Object} [options] - Configuration options
 * @param {string} [options.path='/ws'] - WebSocket endpoint path
 * @param {number} [options.maxPayload=1048576] - Maximum message size in bytes
 * @returns {Object} WebSocket core API
 * 
 * @example
 * const express = require('express');
 * const http = require('http');
 * const { attachWebSocketServer } = require('./ws-core');
 * 
 * const app = express();
 * const server = http.createServer(app);
 * 
 * const wsCore = attachWebSocketServer(server, { path: '/ws' });
 * 
 * server.listen(3000);
 */
function attachWebSocketServer(httpServer, options = {}) {
  if (!httpServer) {
    throw new Error('httpServer is required');
  }

  if (wss) {
    throw new Error('WebSocket server already attached. Call detach() first.');
  }

  // B1: path must match frontend DEFAULT_WS_PATH ('/ws') for proxy/readiness
  const { path = '/ws', ...wsOptions } = options;

  // Create WebSocket server
  wss = createWebSocketServer(wsOptions);

  // Handle upgrade requests
  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);

    if (pathname === path) {
      handleUpgrade(wss, request, socket, head);
    } else {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('ws-core', 'ws_upgrade_path_mismatch', { pathname, expectedPath: path });
      }
      socket.destroy();
    }
  });

  logger.info('ws-core', 'server_attached', { path, protocolVersion: config.PROTOCOL_VERSION });

  // Setup process handlers (uncaught errors)
  setupProcessHandlers();

  // Return public API
  return createPublicApi();
}

/**
 * Setup process handlers for uncaught errors
 */
function setupProcessHandlers() {
  const shutdownHandler = async (signal) => {
    logger.info('ws-core', 'signal_received', { signal });
    
    if (wss) {
      try {
        await shutdown(wss);
        wss = null;
        logger.info('ws-core', 'shutdown_complete', {});
        process.exit(0);
      } catch (error) {
        logger.error('ws-core', 'shutdown_error', { error: error.message });
        process.exit(1);
      }
    } else {
      process.exit(0);
    }
  };

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('ws-core', 'uncaught_exception', { error: error.message, stack: error.stack });
    shutdownHandler('uncaughtException').catch(() => {
      process.exit(1);
    });
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('ws-core', 'unhandled_rejection', { 
      reason: reason?.message || String(reason),
      stack: reason?.stack,
    });
  });
}

/**
 * Detach and shutdown WebSocket server
 * @returns {Promise<void>}
 */
async function detach() {
  if (wss) {
    await shutdown(wss);
    wss = null;
    logger.info('ws-core', 'server_detached', {});
  }
}

/**
 * Create public API object
 * @returns {Object} Public API
 */
function createPublicApi() {
  const api = {
    /**
     * Get connection manager for direct access
     */
    connections: connectionManager,

    /**
     * Get presence engine for direct access
     */
    presence: presenceEngine,

    /**
     * Get message engine for direct access
     */
    messages: messageEngine,

    /**
     * Get Redis adapter for direct access
     */
    redis: redisAdapter,

    /**
     * Send message to a specific user (protocol/delivery layer; ConnectionManager is lifecycle only)
     * @param {string} userId - Target user ID
     * @param {Object} message - Message to send
     * @returns {number} Number of connections message was sent to (0 or 1)
     */
    sendToUser(userId, message) {
      const sockets = connectionManager.getSockets(userId);
      let count = 0;
      for (const ws of sockets) {
        const result = socketSafety.sendMessage(ws, message);
        if (result.shouldClose) {
          socketSafety.closeAbusiveConnection(ws, 'Slow consumer: queue overflow', 1008);
          continue;
        }
        if (result.queued) count += 1;
      }
      return count;
    },

    /**
     * Broadcast message to all connected users
     * @param {Object} message - Message to broadcast
     * @param {string[]} [excludeUserIds] - Users to exclude
     * @returns {number} Number of users message was sent to
     */
    broadcast(message, excludeUserIds = []) {
      if (message && !message.version) message.version = config.PROTOCOL_VERSION;
      const exclude = excludeUserIds || [];
      let socketCount = 0;
      for (const userId of connectionManager.getConnectedUsers()) {
        if (exclude.includes(userId)) continue;
        const sockets = connectionManager.getSockets(userId);
        for (const ws of sockets) {
          const result = socketSafety.sendMessage(ws, message);
          if (result.shouldClose) socketSafety.closeAbusiveConnection(ws, 'Slow consumer: queue overflow', 1008);
          socketCount += 1;
        }
      }
      return socketCount;
    },

    /**
     * Check if a user is currently connected
     * @param {string} userId - User ID to check
     * @returns {boolean} True if user has active connections
     */
    isUserOnline(userId) {
      return connectionManager.isUserConnected(userId);
    },

    /**
     * Get all connected user IDs
     * @returns {string[]} Array of user IDs
     */
    getConnectedUsers() {
      return connectionManager.getConnectedUsers();
    },

    /**
     * Get total number of active connections
     * @returns {number} Connection count
     */
    getConnectionCount() {
      return connectionManager.getConnectionCount();
    },

    /**
     * Get user's presence status
     * @param {string} userId - User ID
     * @returns {Object|null} Presence data
     */
    getUserPresence(userId) {
      return presenceEngine.getPresence(userId);
    },

    /**
     * Get all online users
     * @returns {string[]} Array of online user IDs
     */
    getOnlineUsers() {
      return presenceEngine.getOnlineUsers();
    },

    /**
     * Subscribe to presence changes
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    onPresenceChange(callback) {
      return presenceEngine.onPresenceChange(callback);
    },

    /**
     * Gracefully shutdown the WebSocket server
     * @returns {Promise<void>}
     */
    shutdown: detach,

    /**
     * Get the raw WebSocketServer instance (for advanced use)
     * @returns {WebSocketServer|null}
     */
    getServer() {
      return wss;
    },

    /**
     * Get monitoring metrics
     * @returns {Object} Current metrics
     */
    getMetrics() {
      return monitoring.getMetrics();
    },

    /**
     * Subscribe to metric changes
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
     */
    onMetricChange(callback) {
      return monitoring.onMetricChange(callback);
    },

    /**
     * Get protocol version
     * @returns {string} Protocol version
     */
    getProtocolVersion() {
      return config.PROTOCOL_VERSION;
    },
    /**
     * Get error codes enum for clients
     * @returns {Object} Error codes
     */
    getErrorCodes() {
      return ErrorCodes;
    },

    // ==================== Room API ====================

    /**
     * Get room manager for direct access
     */
    rooms: roomManager,

    /**
     * Create a new room
     * @param {string} roomId - Room identifier
     * @param {string} creatorUserId - User ID of the creator
     * @param {Object} [options] - Room options
     * @returns {{success: boolean, error?: string}}
     */
    createRoom(roomId, creatorUserId, options = {}) {
      return roomManager.createRoom(roomId, creatorUserId, options);
    },

    /**
     * Delete a room
     * @param {string} roomId - Room identifier
     * @returns {{success: boolean, error?: string}}
     */
    deleteRoom(roomId) {
      return roomManager.deleteRoom(roomId);
    },

    /**
     * Add a user to a room
     * @param {string} roomId - Room identifier
     * @param {string} userId - User identifier
     * @returns {{success: boolean, error?: string}}
     */
    joinRoom(roomId, userId) {
      return roomManager.joinRoom(roomId, userId);
    },

    /**
     * Remove a user from a room
     * @param {string} roomId - Room identifier
     * @param {string} userId - User identifier
     * @returns {{success: boolean, error?: string}}
     */
    leaveRoom(roomId, userId) {
      return roomManager.leaveRoom(roomId, userId);
    },

    /**
     * Get all members of a room
     * @param {string} roomId - Room identifier
     * @returns {string[]} Array of user IDs
     */
    getRoomMembers(roomId) {
      return roomManager.getRoomMembers(roomId);
    },

    /**
     * Get all rooms a user is a member of
     * @param {string} userId - User identifier
     * @returns {string[]} Array of room IDs
     */
    getUserRooms(userId) {
      return roomManager.getUserRooms(userId);
    },

    /**
     * Check if a user is a member of a room
     * @param {string} roomId - Room identifier
     * @param {string} userId - User identifier
     * @returns {boolean}
     */
    isRoomMember(roomId, userId) {
      return roomManager.isRoomMember(roomId, userId);
    },

    /**
     * Get room information
     * @param {string} roomId - Room identifier
     * @returns {Object|null} Room info or null
     */
    getRoomInfo(roomId) {
      return roomManager.getRoomInfo(roomId);
    },

    /**
     * Get all rooms
     * @returns {Array} Array of room info objects
     */
    getAllRooms() {
      return roomManager.getAllRooms();
    },

    /**
     * Broadcast message to all members of a room
     * @param {string} roomId - Room identifier
     * @param {Object} message - Message to broadcast
     * @param {string} [excludeUserId] - User ID to exclude
     * @returns {{success: boolean, sentCount: number, memberCount: number, error?: string}}
     */
    broadcastToRoom(roomId, message, excludeUserId = null) {
      return roomManager.broadcastToRoom(roomId, message, excludeUserId);
    },

    /**
     * Get room statistics
     * @returns {Object} Room statistics
     */
    getRoomStats() {
      return roomManager.getStats();
    },

    // ==================== Tier-3: Offline & History ====================

    /**
     * Get paginated chat history for a user (Tier-3)
     * @param {string} userId - Recipient user ID
     * @param {{ beforeId?: string, limit?: number }} [options]
     * @returns {Promise<{ messages: Array<Object>, nextCursor: string|null, hasMore: boolean }>}
     */
    async getHistory(userId, options = {}) {
      return historyService.getHistory(userId, options);
    },

    /**
     * Attach GET /history to an Express Router (Tier-3). Requires Express.
     * @param {Object} router - Express.Router()
     * @returns {Object} Same router
     */
    attachHistoryRoutes(router) {
      return historyController.attachHistoryRoutes(router);
    },

    /**
     * Handle GET /history request (Tier-3). Use for raw Node or custom frameworks.
     * @param {{ query: Object, userId?: string, user?: { id: string } }} req
     * @returns {Promise<{ status: number, body: Object }>}
     */
    async handleHistoryRequest(req) {
      return historyController.handleHistoryRequest(req);
    },
  };

  const userUpdated = require('../events/userUpdated');
  userUpdated.onUserUpdated((payload) => {
    api.broadcast({
      type: 'USER_UPDATED',
      userId: payload.userId,
      displayName: payload.displayName ?? null,
      avatarUrl: payload.avatarUrl ?? null,
      updatedAt: typeof payload.updatedAt === 'number' ? payload.updatedAt : null,
    });
  });

  return api;
}

module.exports = {
  attachWebSocketServer,
  detach,
  // Tier-3: direct access for custom mounting
  historyService: require('../services/history.service'),
  historyController: require('../http/controllers/history.controller'),
  messageStore: require('../services/message.store'),
  offlineQueue: require('./state/offline/offline.queue'),
  offlineSync: require('./state/offline/offline.sync'),
  wsResync: require('./state/ws.resync'),
};
