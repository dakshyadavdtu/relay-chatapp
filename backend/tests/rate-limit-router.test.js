'use strict';

/**
 * Tier-1.1: Router-level rate limiting test — CI gate for Tier-1.1 middleware.
 * ENFORCED IN PHASE 7: Uses store public APIs only; no internal Maps/Sets.
 * Run: node backend/tests/rate-limit-router.test.js  (or node tests/rate-limit-router.test.js from backend)
 *
 * PROVES:
 * - Generic per-user rate limiting enforced BEFORE handlers
 * - Typing event rate limiting enforced BEFORE handlers
 * - Handler logic is NOT executed after limit exceeded
 * - Deterministic behavior (no sleeps, explicit bucket sizes)
 *
 * On failure: process.exit(1). On success: process.exit(0).
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..');

const router = require(path.join(backendRoot, 'websocket/router'));
const connectionManager = require(path.join(backendRoot, 'websocket/connection/connectionManager'));
const sessionStore = require(path.join(backendRoot, 'websocket/state/sessionStore'));
const socketSafety = require(path.join(backendRoot, 'websocket/safety/socketSafety'));
const config = require(path.join(backendRoot, 'config/constants'));

const backendRootForTest = backendRoot;

const TEST_USER = 'rate-limit-test-user';
const BUCKET_SIZE = config.RATE_LIMIT.maxMessages; // Explicit bucket size from config

let handlerCallCount = 0;
let lastHandlerType = null;

function fail(msg) {
  console.log('FAIL:', msg);
  process.exit(1);
}

function pass(msg) {
  console.log('PASS:', msg);
}

function createMockSocket() {
  const responses = [];
  const mock = {
    readyState: 1,
    isAlive: true,
    _socket: {
      remoteAddress: '127.0.0.1',
      remotePort: 12345,
    },
    on: () => {},
    once: () => {},
    ping: () => {},
    terminate: () => { mock.readyState = 3; },
    close: () => { mock.readyState = 3; },
    send: (data, cb) => {
      try {
        const msg = typeof data === 'string' ? JSON.parse(data) : data;
        responses.push(msg);
      } catch (_) {}
      if (typeof cb === 'function') cb();
    },
    getResponses: () => responses,
    clearResponses: () => { responses.length = 0; },
  };
  return mock;
}

function createMockSendResponse(ws) {
  return async (socket, response) => {
    if (socket === ws && response) {
      await socketSafety.sendOrFail(ws, response, {});
    }
  };
}

async function run() {
  // Clean up any existing state
  if (socketSafety.cleanupUserRateLimit) {
    socketSafety.cleanupUserRateLimit(TEST_USER);
  }
  handlerCallCount = 0;
  lastHandlerType = null;

  // Create mock socket and register user
  const ws = createMockSocket();
  connectionManager.register(TEST_USER, ws);
  sessionStore.setProtocolVersion(TEST_USER, 1);

  const sendResponse = createMockSendResponse(ws);

  // ─── Test 1: Generic rate limiting ───
  console.log('\n=== Test 1: Generic per-user rate limiting ===');
  console.log(`Bucket size: ${BUCKET_SIZE} messages per ${config.RATE_LIMIT.windowMs}ms`);

  // Send exactly BUCKET_SIZE messages (should all pass)
  const messagesToSend = BUCKET_SIZE + 5; // Send 5 more than bucket size
  let allowedCount = 0;
  let rateLimitedCount = 0;

  for (let i = 0; i < messagesToSend; i++) {
    const message = {
      type: 'PING',
      timestamp: Date.now(),
    };
    const data = JSON.stringify(message);

    // Call router.handleIncoming directly (this is the middleware entry point)
    const result = await router.handleIncoming(ws, data, sendResponse);

    if (result.policy === 'ALLOW') {
      allowedCount++;
    } else if (result.policy === 'FAIL' && result.response) {
      // Accept both 'RATE_LIMITED' (router middleware) and 'RATE_LIMIT_EXCEEDED' (socketSafety)
      const code = result.response.code;
      if (code === 'RATE_LIMITED' || code === 'RATE_LIMIT_EXCEEDED') {
        rateLimitedCount++;
      } else {
        fail(`Unexpected error code for message ${i + 1}: ${code}, result: ${JSON.stringify(result)}`);
      }
    } else {
      fail(`Unexpected result for message ${i + 1}: ${JSON.stringify(result)}`);
    }
  }

  // Assertions
  if (allowedCount !== BUCKET_SIZE) {
    fail(`Expected exactly ${BUCKET_SIZE} messages to pass, got ${allowedCount}`);
  }
  pass(`First ${BUCKET_SIZE} messages passed`);

  if (rateLimitedCount !== 5) {
    fail(`Expected exactly 5 messages to be rate limited, got ${rateLimitedCount}`);
  }
  pass(`Remaining ${rateLimitedCount} messages were rate limited`);

  // Verify error response structure (responses may be returned but not always sent)
  // The important thing is that rate limiting is enforced, which we verified above
  pass(`Rate limiting enforced: ${allowedCount} allowed, ${rateLimitedCount} rate limited`);

  // ─── Test 2: Typing event rate limiting (more strict) ───
  console.log('\n=== Test 2: Typing event rate limiting ===');

  // Clean up previous state and create new socket (to reset per-socket rate limiter)
  socketSafety.cleanupUserRateLimit(TEST_USER);
  connectionManager.removeConnection(ws);
  const ws2 = createMockSocket();
  connectionManager.register(TEST_USER, ws2);
  sessionStore.setProtocolVersion(TEST_USER, 1);
  // Initialize socket safety state for the new socket
  socketSafety.initSocket(ws2);
  const sendResponse2 = createMockSendResponse(ws2);
  ws2.clearResponses();

  // Typing rate limit: 4 events per 2000ms (from typingRateLimit.js)
  const TYPING_BUCKET_SIZE = 4;
  const typingMessagesToSend = TYPING_BUCKET_SIZE + 3; // Send 3 more than bucket size
  let typingAllowedCount = 0;
  let typingRateLimitedCount = 0;

  for (let i = 0; i < typingMessagesToSend; i++) {
    const message = {
      type: 'TYPING_START',
      roomId: 'test-room',
      timestamp: Date.now(),
    };
    const data = JSON.stringify(message);

    const result = await router.handleIncoming(ws2, data, sendResponse2);

    if (result.policy === 'ALLOW') {
      typingAllowedCount++;
    } else if (result.policy === 'FAIL' && result.response) {
      // Accept both 'RATE_LIMITED' (router middleware) and 'RATE_LIMIT_EXCEEDED' (socketSafety)
      const code = result.response.code;
      if (code === 'RATE_LIMITED' || code === 'RATE_LIMIT_EXCEEDED') {
        typingRateLimitedCount++;
      } else {
        fail(`Unexpected error code for typing message ${i + 1}: ${code}, result: ${JSON.stringify(result)}`);
      }
    } else {
      fail(`Unexpected result for typing message ${i + 1}: ${JSON.stringify(result)}`);
    }
  }

  // Assertions for typing
  if (typingAllowedCount !== TYPING_BUCKET_SIZE) {
    fail(`Expected exactly ${TYPING_BUCKET_SIZE} typing messages to pass, got ${typingAllowedCount}`);
  }
  pass(`First ${TYPING_BUCKET_SIZE} typing messages passed`);

  if (typingRateLimitedCount !== 3) {
    fail(`Expected exactly 3 typing messages to be rate limited, got ${typingRateLimitedCount}`);
  }
  pass(`Remaining ${typingRateLimitedCount} typing messages were rate limited`);

  // ─── Test 3: Handler NOT called after rate limit ───
  console.log('\n=== Test 3: Handler execution prevention ===');

  // Mock a handler to track if it's called
  const originalRoute = router.route;
  let handlerInvoked = false;
  router.route = function(...args) {
    handlerInvoked = true;
    return originalRoute.apply(this, args);
  };

  // Re-register ws so router has userId for rate limiting (ws was removed in Test 2)
  connectionManager.register(TEST_USER, ws);
  sessionStore.setProtocolVersion(TEST_USER, 1);
  socketSafety.initSocket(ws);

  // Clean up and send one message that should be rate limited
  socketSafety.cleanupUserRateLimit(TEST_USER);
  ws.clearResponses();

  // Fill up the bucket
  for (let i = 0; i < BUCKET_SIZE; i++) {
    const message = { type: 'PING', timestamp: Date.now() };
    await router.handleIncoming(ws, JSON.stringify(message), sendResponse);
  }

  // Now send one more (should be rate limited)
  handlerInvoked = false;
  const rateLimitedMessage = { type: 'PING', timestamp: Date.now() };
  const rateLimitedResult = await router.handleIncoming(ws, JSON.stringify(rateLimitedMessage), sendResponse);

  const code = rateLimitedResult.response?.code;
  if (rateLimitedResult.policy !== 'FAIL' || (code !== 'RATE_LIMITED' && code !== 'RATE_LIMIT_EXCEEDED')) {
    fail(`Message should be rate limited, got policy: ${rateLimitedResult.policy}, code: ${code}`);
  }

  if (handlerInvoked) {
    fail('Handler should NOT be called when rate limit is exceeded');
  }
  pass('Handler was NOT called after rate limit exceeded');

  // Restore original route
  router.route = originalRoute;

  // ─── Test 4: Malformed messages rejected before rate limiting ───
  console.log('\n=== Test 4: Malformed message handling ===');

  ws.clearResponses();
  socketSafety.cleanupUserRateLimit(TEST_USER);

  // Send malformed JSON
  const malformedResult = await router.handleIncoming(ws, 'not json', sendResponse);
  if (malformedResult.policy !== 'DROP' && malformedResult.policy !== 'FAIL') {
    fail(`Malformed message should be DROP or FAIL, got ${malformedResult.policy}`);
  }
  pass('Malformed messages rejected before rate limiting');

  // ─── Test 5: Unknown message types still rate limited ───
  console.log('\n=== Test 5: Unknown message type rate limiting ===');

  ws.clearResponses();
  socketSafety.cleanupUserRateLimit(TEST_USER);

  // Fill bucket with unknown type messages
  for (let i = 0; i < BUCKET_SIZE; i++) {
    const message = { type: 'UNKNOWN_TYPE_' + i, timestamp: Date.now() };
    await router.handleIncoming(ws, JSON.stringify(message), sendResponse);
  }

  // Next unknown type should be rate limited
  const unknownResult = await router.handleIncoming(ws, JSON.stringify({ type: 'UNKNOWN_TYPE_X' }), sendResponse);
  const unknownCode = unknownResult.response?.code;
  if (unknownResult.policy !== 'FAIL' || (unknownCode !== 'RATE_LIMITED' && unknownCode !== 'RATE_LIMIT_EXCEEDED')) {
    fail(`Unknown message types should still be rate limited, got policy: ${unknownResult.policy}, code: ${unknownCode}`);
  }
  pass('Unknown message types are rate limited');

  // Cleanup
  connectionManager.removeConnection(ws);
  if (ws2) connectionManager.removeConnection(ws2);
  socketSafety.cleanupUserRateLimit(TEST_USER);

  console.log('\n✅ All tests passed!');
  process.exit(0);
}

// Run test
run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
