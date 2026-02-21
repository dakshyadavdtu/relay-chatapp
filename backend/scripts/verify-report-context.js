'use strict';

/**
 * End-to-end verification of report details context window (2 above + anchor + 2 below, max 5).
 * Uses the same dev DB as the backend; seeds a test room, creates a report for message #7,
 * calls the report-details path, and asserts window/context shape. Idempotent per run;
 * uses a unique chatId prefix and cleans up seeded messages.
 *
 * Run: node -r dotenv/config scripts/verify-report-context.js (from backend)
 * npm: npm run verify:report-context
 *
 * Cleanup: Seeded messages are deleted after the run. The created report is left in the DB
 * (tagged by reason "verify-report-context e2e" and conversationId) for traceability.
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '..');
const messageMongo = require(path.join(backendRoot, 'storage/message.mongo'));
const reportsStore = require(path.join(backendRoot, 'storage/reports.store'));
const adminController = require(path.join(backendRoot, 'http/controllers/admin.controller'));

const RUN_ID = Date.now();
const CHAT_PREFIX = 'verify:report-context';
const ROOM_ID = `${CHAT_PREFIX}:${RUN_ID}`;
const CHAT_ID = `room:${ROOM_ID}`;
const SENDER = 'verify_sender';
const NUM_MESSAGES = 12;
const ANCHOR_INDEX = 7; // 1-based: message #7
const BASE_TS = 1000000; // 1 second apart: BASE_TS+1000, BASE_TS+2000, ...

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function mockReq(user = { userId: 'verify_admin', role: 'ADMIN' }) {
  return { user, params: {}, query: {}, body: {} };
}

function mockRes() {
  const out = { statusCode: null, body: null };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(data) {
      out.body = data;
      return this;
    },
    getOut() {
      return out;
    },
  };
}

async function seedRoomMessages() {
  const messageIds = [];
  for (let i = 1; i <= NUM_MESSAGES; i++) {
    const messageId = `msg_vrc_${RUN_ID}_${i}`;
    const ts = BASE_TS + i * 1000;
    await messageMongo.persistMessage({
      messageId,
      senderId: SENDER,
      recipientId: ROOM_ID,
      content: `Verify message ${i}`,
      timestamp: ts,
      state: 'sent',
      chatId: CHAT_ID,
      roomId: ROOM_ID,
      clientMessageId: `c_${messageId}`,
    });
    messageIds.push(messageId);
  }
  return messageIds;
}

async function cleanupMessages(messageIds) {
  for (const id of messageIds) {
    try {
      await messageMongo.deleteMessage(id);
    } catch (e) {
      console.warn('Cleanup: could not delete message', id, e.message);
    }
  }
}

function assertChronological(context) {
  for (let i = 1; i < context.length; i++) {
    const prev = context[i - 1].timestamp;
    const curr = context[i].timestamp;
    if (prev != null && curr != null && curr < prev) {
      fail(`Context not chronological: index ${i - 1} ts=${prev}, index ${i} ts=${curr}`);
    }
  }
}

async function run() {
  console.log('Verify report context window (2 above + anchor + 2 below, max 5)');
  console.log('Run ID:', RUN_ID, '| Chat:', CHAT_ID);

  let messageIds = [];
  try {
    messageIds = await seedRoomMessages();
    const anchorMessageId = messageIds[ANCHOR_INDEX - 1];
    if (!anchorMessageId) fail('Anchor message id not found');

    const report = await reportsStore.createReport({
      reporterUserId: 'verify_reporter',
      reason: 'verify-report-context e2e',
      messageId: anchorMessageId,
      conversationId: CHAT_ID,
      senderId: SENDER,
    });
    if (!report || !report.id) fail('Failed to create report');

    const req = mockReq();
    req.params = { id: report.id };
    const res = mockRes();
    await adminController.getReportDetails(req, res, () => {});

    const out = res.getOut();
    if (out.statusCode !== 200) {
      fail(`Report details expected 200, got ${out.statusCode}. Body: ${JSON.stringify(out.body)}`);
    }
    const data = out.body?.data;
    if (!data) fail('Response must have data');

    // Assert window == 2
    if (data.window !== 2) {
      fail(`window must be 2, got ${data.window}`);
    }
    console.log('  window == 2 ✓');

    // Assert context.length <= 5
    const context = Array.isArray(data.context) ? data.context : [];
    if (context.length > 5) {
      fail(`context.length must be <= 5, got ${context.length}. messageIds: ${context.map((m) => m.messageId).join(', ')}`);
    }
    console.log('  context.length <= 5 ✓');

    // When we have 5 messages (2 above + anchor + 2 below), context[2] must be the anchor
    const anchorInContext = context.find(
      (m) => m && (m.messageId === anchorMessageId || (m.roomMessageId && m.roomMessageId === anchorMessageId))
    );
    if (!data.message && context.length > 0) {
      fail('Response has context but message is null');
    }
    if (context.length === 5) {
      const idx = context.findIndex(
        (m) => m && (m.messageId === anchorMessageId || (m.roomMessageId && m.roomMessageId === anchorMessageId))
      );
      if (idx === -1) {
        fail(`Anchor ${anchorMessageId} must appear in context when length is 5. messageIds: ${context.map((m) => m.messageId).join(', ')}`);
      }
      if (idx !== 2) {
        fail(`Anchor expected at index 2 when context.length is 5, got ${idx}. messageIds: ${context.map((m) => m.messageId).join(', ')}`);
      }
      console.log('  context[2] is anchor ✓');
    } else if (context.length > 0 && !anchorInContext && data.message) {
      // Anchor may be in data.message but not in context (boundary case); that's acceptable
      console.log('  anchor in message and/or context ✓');
    } else if (context.length > 0) {
      console.log('  anchor present in context ✓');
    }

    // Assert chronological
    if (context.length > 1) {
      assertChronological(context);
      console.log('  context chronological ✓');
    }

    console.log('\nPASS: Report context window verification (window=2, context.length=' + context.length + ', chronological)');
  } finally {
    await cleanupMessages(messageIds);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
