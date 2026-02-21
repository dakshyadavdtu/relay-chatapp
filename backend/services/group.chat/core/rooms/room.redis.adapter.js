/**
 * core/rooms/room.redis.adapter.js
 *
 * Redis Pub/Sub adapter skeleton for horizontal scaling.
 * This is an INTERFACE ONLY - Redis is NOT connected.
 *
 * PURPOSE:
 * In a multi-node WebSocket server setup, each node handles a subset of connections.
 * When a message needs to be broadcast to a room, some recipients may be on other nodes.
 * Redis Pub/Sub enables cross-node message distribution.
 *
 * HOW IT WORKS:
 * 1. Node A receives message for room "chat-123"
 * 2. Node A computes local fan-out (connections on Node A)
 * 3. Node A publishes to Redis channel "room:chat-123" with message payload
 * 4. All nodes subscribed to "room:chat-123" receive the message
 * 5. Each node delivers to its local connections in that room
 *
 * FAN-OUT CHANGES IN MULTI-NODE:
 * - Single-node: fan-out = all room connections (local only)
 * - Multi-node: fan-out = local connections + Redis publish
 * - Each node only delivers to its own connections
 * - Redis ensures all nodes see the message
 *
 * STICKY SESSIONS REQUIREMENT:
 * WebSocket connections are stateful. A connection must always route to the same
 * server node for its lifetime. Load balancers must use:
 * - IP-based sticky sessions (same IP → same node)
 * - Cookie-based sticky sessions (session cookie → same node)
 * - Connection ID-based routing (hash connectionId → node)
 *
 * Without sticky sessions:
 * - Connection might reconnect to different node
 * - Node might not have connection's room membership state
 * - Messages could be lost or duplicated
 *
 * Load balancer config example (nginx):
 *   upstream websocket {
 *     ip_hash;  # Sticky sessions by IP
 *     server node1:8080;
 *     server node2:8080;
 *   }
 */

"use strict";

// -----------------------------------------------------------------------------
// Redis Adapter Interface (skeleton - NOT implemented)
// -----------------------------------------------------------------------------

/**
 * Publish message to Redis channel for a room.
 * All nodes subscribed to this room will receive the message.
 *
 * @param {string} roomId - Room identifier
 * @param {Object} message - Message payload to broadcast
 * @returns {Promise<void>}
 */
async function publish(roomId, message) {
  // TODO: Connect to Redis
  // TODO: Publish to channel: `room:${roomId}`
  // TODO: Serialize message payload
  // Example: await redisClient.publish(`room:${roomId}`, JSON.stringify(message));
  
  throw new Error("Redis adapter not implemented - this is a skeleton interface");
}

/**
 * Subscribe to Redis channel for a room.
 * When messages are published to this room, the handler will be called.
 *
 * @param {string} roomId - Room identifier
 * @param {Function} handler - Callback(message) when message received
 * @returns {Promise<void>}
 */
async function subscribe(roomId, handler) {
  // TODO: Connect to Redis subscriber client
  // TODO: Subscribe to channel: `room:${roomId}`
  // TODO: On message, deserialize and call handler(message)
  // Example:
  //   const subscriber = redisClient.duplicate();
  //   await subscriber.subscribe(`room:${roomId}`);
  //   subscriber.on('message', (channel, msg) => {
  //     handler(JSON.parse(msg));
  //   });
  
  throw new Error("Redis adapter not implemented - this is a skeleton interface");
}

/**
 * Unsubscribe from Redis channel for a room.
 *
 * @param {string} roomId - Room identifier
 * @returns {Promise<void>}
 */
async function unsubscribe(roomId) {
  // TODO: Unsubscribe from channel: `room:${roomId}`
  // Example: await subscriber.unsubscribe(`room:${roomId}`);
  
  throw new Error("Redis adapter not implemented - this is a skeleton interface");
}

/**
 * Initialize Redis connection (called at server startup).
 * In production, this would:
 * - Connect to Redis cluster
 * - Set up connection pooling
 * - Handle reconnection logic
 * - Set up error handlers
 *
 * @returns {Promise<void>}
 */
async function initialize() {
  // TODO: Create Redis client
  // TODO: Create Redis subscriber client
  // TODO: Set up connection event handlers
  // TODO: Configure retry logic
  
  throw new Error("Redis adapter not implemented - this is a skeleton interface");
}

/**
 * Close Redis connections (called at server shutdown).
 *
 * @returns {Promise<void>}
 */
async function shutdown() {
  // TODO: Close Redis client connections
  // TODO: Clean up subscriptions
  
  throw new Error("Redis adapter not implemented - this is a skeleton interface");
}

// -----------------------------------------------------------------------------
// Integration Notes
// -----------------------------------------------------------------------------

/**
 * HOW TO INTEGRATE WITH BROADCAST:
 *
 * In room.broadcast.js, modify broadcastToRoom():
 *
 *   function broadcastToRoom(options) {
 *     const { roomId, senderConnectionId, message } = options;
 *
 *     // 1. Compute local fan-out (connections on this node)
 *     const localRecipients = computeFanOut({ roomId, senderConnectionId });
 *
 *     // 2. Publish to Redis for other nodes
 *     redisAdapter.publish(roomId, {
 *       roomId,
 *       message,
 *       senderConnectionId,
 *     });
 *
 *     // 3. Return local recipients (this node delivers to these)
 *     return localRecipients;
 *   }
 *
 * On each node, subscribe to rooms when connections join:
 *
 *   roomMembership.joinRoom({ roomId, connectionId });
 *   redisAdapter.subscribe(roomId, (message) => {
 *     // Deliver to local connections in this room
 *     const localConnections = roomMembership.getRoomConnectionsList(roomId);
 *     localConnections.forEach(connId => {
 *       websocketServer.send(connId, message);
 *     });
 *   });
 */

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  publish,
  subscribe,
  unsubscribe,
  initialize,
  shutdown,
};
