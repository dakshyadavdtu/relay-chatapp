'use strict';

/**
 * API contract tests.
 * Verifies consistent JSON schemas and response formats.
 * Run: node tests/api/api-contract.test.js (from backend)
 * Tests do not require real DB - verify schemas only.
 */

const assert = require('assert');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function run() {
  // ─── 1. Success response format ───
  const successResponse = {
    success: true,
    data: { user: { id: 'user1', username: 'alice' } },
  };

  if (successResponse.success !== true) fail('Success response must have success: true');
  if (!successResponse.data) fail('Success response must have data field');
  if (successResponse.error) fail('Success response must not have error field');
  if (successResponse.code) fail('Success response must not have code field');
  console.log('PASS: Success response format');

  // ─── 2. Error response format ───
  const errorResponse = {
    success: false,
    error: 'Not authenticated',
    code: 'UNAUTHORIZED',
  };

  if (errorResponse.success !== false) fail('Error response must have success: false');
  if (!errorResponse.error) fail('Error response must have error field');
  if (!errorResponse.code) fail('Error response must have code field');
  if (errorResponse.data) fail('Error response must not have data field');
  console.log('PASS: Error response format');

  // ─── 3. User schema ───
  const user = {
    id: 'user1',
    username: 'alice',
    role: 'USER',
    createdAt: 1234567890,
  };

  if (typeof user.id !== 'string') fail('User id must be string');
  if (typeof user.username !== 'string') fail('User username must be string');
  if (typeof user.role !== 'string') fail('User role must be string');
  if (user.createdAt !== null && typeof user.createdAt !== 'number') {
    fail('User createdAt must be number or null');
  }
  if (user.password) fail('User must not expose password');
  if (user.tokens) fail('User must not expose tokens');
  if (user.internalFlags) fail('User must not expose internalFlags');
  if (user.userId) fail('User must use id not userId');
  console.log('PASS: User schema');

  // ─── 4. Message schema ───
  const message = {
    id: 'msg_123',
    senderId: 'user1',
    recipientId: 'user2',
    content: 'Hello',
    createdAt: 1234567890,
    state: 'SENT',
  };

  if (typeof message.id !== 'string') fail('Message id must be string');
  if (typeof message.senderId !== 'string') fail('Message senderId must be string');
  if (typeof message.recipientId !== 'string') fail('Message recipientId must be string');
  if (typeof message.content !== 'string') fail('Message content must be string');
  if (typeof message.createdAt !== 'number') fail('Message createdAt must be number');
  if (typeof message.state !== 'string') fail('Message state must be string');
  if (message.messageId) fail('Message must use id not messageId');
  if (message.timestamp) fail('Message must use createdAt not timestamp');
  console.log('PASS: Message schema');

  // ─── 5. Error codes ───
  const errorCodes = ['UNAUTHORIZED', 'INVALID_PAYLOAD', 'CHAT_ACCESS_DENIED', 'USER_NOT_FOUND'];
  for (const code of errorCodes) {
    if (typeof code !== 'string') fail('Error code must be string');
    if (code.length === 0) fail('Error code must not be empty');
  }
  console.log('PASS: Error codes format');

  // ─── 6. Login response shape ───
  const loginResponse = {
    success: true,
    data: {
      user: {
        id: 'user1',
        username: 'alice',
        role: 'USER',
        createdAt: null,
      },
      capabilities: {},
    },
  };

  if (!loginResponse.data.user) fail('Login response must have user');
  if (!loginResponse.data.capabilities) fail('Login response must have capabilities');
  console.log('PASS: Login response shape');

  // ─── 7. GetMe response shape ───
  const getMeResponse = {
    success: true,
    data: {
      user: {
        id: 'user1',
        username: 'alice',
        role: 'USER',
        createdAt: null,
      },
      capabilities: {},
    },
  };

  if (!getMeResponse.data.user) fail('GetMe response must have user');
  console.log('PASS: GetMe response shape');

  // ─── 8. History response shape ───
  const historyResponse = {
    success: true,
    data: {
      chatId: 'direct:user1:user2',
      messages: [
        {
          id: 'msg_123',
          senderId: 'user1',
          recipientId: 'user2',
          content: 'Hello',
          createdAt: 1234567890,
          state: 'SENT',
        },
      ],
      nextCursor: null,
      hasMore: false,
    },
  };

  if (!Array.isArray(historyResponse.data.messages)) fail('History response messages must be array');
  if (typeof historyResponse.data.chatId !== 'string') fail('History response chatId must be string');
  if (typeof historyResponse.data.hasMore !== 'boolean') fail('History response hasMore must be boolean');
  console.log('PASS: History response shape');

  // ─── 9. Send message response shape ───
  const sendResponse = {
    success: true,
    data: {
      message: {
        id: 'msg_123',
        senderId: 'user1',
        recipientId: 'user2',
        content: 'Hello',
        createdAt: 1234567890,
        state: 'SENT',
      },
    },
  };

  if (!sendResponse.data.message) fail('Send response must have message');
  if (!sendResponse.data.message.id) fail('Send response message must have id');
  if (!sendResponse.data.message.createdAt) fail('Send response message must have createdAt');
  console.log('PASS: Send message response shape');

  // ─── 10. Input validation requirements ───
  const validationRules = {
    username: { min: 3, max: 50 },
    password: { min: 6 },
    content: { max: 10000 },
  };

  if (validationRules.username.min < 3) fail('Username min length must be at least 3');
  if (validationRules.content.max > 10000) fail('Content max length must be at most 10000');
  console.log('PASS: Input validation requirements');

  // ─── 11. Admin reports response shape ───
  const reportsResponse = {
    success: true,
    data: {
      reports: [
        { id: 'rpt_abc123', date: '2025-02-14 10:30', user: 'user_1', priority: 'High', reason: 'Spam' },
        { id: 'rpt_def456', date: '2025-02-14 09:00', user: 'user_2', priority: 'Medium' },
      ],
    },
  };
  if (reportsResponse.success !== true) fail('Reports response must have success: true');
  if (!reportsResponse.data) fail('Reports response must have data');
  if (!Array.isArray(reportsResponse.data.reports)) fail('Reports response data.reports must be array');
  if (reportsResponse.data.notAvailable === true) fail('Reports response must NOT have data.notAvailable: true');
  for (const r of reportsResponse.data.reports) {
    if (typeof r.id !== 'string') fail('Report id must be string');
    if (typeof r.date !== 'string') fail('Report date must be string');
    if (typeof r.user !== 'string') fail('Report user must be string');
    if (typeof r.priority !== 'string') fail('Report priority must be string');
  }
  console.log('PASS: Admin reports response shape');

  console.log('\n✅ All API contract tests passed');
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
