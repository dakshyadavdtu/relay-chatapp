'use strict';

/**
 * Admin report details context-window API tests.
 * Proves: GET /admin/reports/:id returns exactly 2 above + anchor + 2 below (max 5),
 * chronological order, dedup by roomMessageId, and never uses getAllHistory.
 *
 * Run: node -r dotenv/config tests/admin/admin-report-context-window.test.js (from backend)
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');
const adminController = require(path.join(backendRoot, 'http/controllers/admin.controller'));
const reportsStore = require(path.join(backendRoot, 'storage/reports.store'));
const messageMongo = require(path.join(backendRoot, 'storage/message.mongo'));
const messageStore = require(path.join(backendRoot, 'services/message.store'));

const CHAT_ID = 'direct:ctx_a:ctx_b';
const SENDER = 'ctx_a';
const RECIPIENT = 'ctx_b';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function mockReq(user = { userId: 'admin_1', role: 'ADMIN' }) {
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

/** Seed N messages with monotonic timestamps; returns array of { messageId, timestamp }. */
async function seedMessages(chatId, n, options = {}) {
  const prefix = options.prefix || 'msg_cw';
  const baseTs = options.baseTs != null ? options.baseTs : 1000;
  const list = [];
  for (let i = 1; i <= n; i++) {
    const messageId = `${prefix}_${i}`;
    const ts = baseTs * i;
    await messageMongo.persistMessage({
      messageId,
      senderId: SENDER,
      recipientId: RECIPIENT,
      content: `Content ${i}`,
      timestamp: ts,
      state: 'sent',
      chatId,
      clientMessageId: `c_${messageId}`,
      roomId: options.roomId || null,
      roomMessageId: options.roomMessageId ? (i === options.roomMessageIdIndex ? options.roomMessageId : null) : null,
    });
    list.push({ messageId, timestamp: ts });
  }
  return list;
}

/** Seed a room with one logical message stored as two docs (same roomMessageId). */
async function seedRoomWithDedup(roomId) {
  const chatId = `room:${roomId}`;
  const baseTs = 5000;
  await messageMongo.persistMessage({
    messageId: 'msg_r1',
    senderId: 'u1',
    recipientId: roomId,
    content: 'First',
    timestamp: baseTs,
    state: 'sent',
    chatId,
    roomId,
    clientMessageId: 'c_msg_r1',
  });
  const roomMsgId = 'rm_shared';
  await messageMongo.persistMessage({
    messageId: 'msg_r2a',
    senderId: 'u2',
    recipientId: roomId,
    content: 'Second',
    timestamp: baseTs + 1000,
    state: 'sent',
    chatId,
    roomId,
    roomMessageId: roomMsgId,
    clientMessageId: 'c_msg_r2a',
  });
  await messageMongo.persistMessage({
    messageId: 'msg_r2b',
    senderId: 'u2',
    recipientId: roomId,
    content: 'Second',
    timestamp: baseTs + 1000,
    state: 'sent',
    chatId,
    roomId,
    roomMessageId: roomMsgId,
    clientMessageId: 'c_msg_r2b',
  });
  await messageMongo.persistMessage({
    messageId: 'msg_r3',
    senderId: 'u3',
    recipientId: roomId,
    content: 'Third',
    timestamp: baseTs + 2000,
    state: 'sent',
    chatId,
    roomId,
    clientMessageId: 'c_msg_r3',
  });
  return { chatId, roomMsgId, anchorMessageId: 'msg_r2a' };
}

async function deleteTestMessages(messageIds) {
  for (const id of messageIds) {
    try {
      await messageMongo.deleteMessage(id);
    } catch (_) {
      /* ignore */
    }
  }
}

function assertContextChronological(context) {
  for (let i = 1; i < context.length; i++) {
    const prev = context[i - 1].timestamp;
    const curr = context[i].timestamp;
    if (prev != null && curr != null && curr < prev) {
      fail(`Context not chronological: index ${i - 1} ts=${prev}, index ${i} ts=${curr}`);
    }
  }
}

function findAnchorIndex(context, reportedMessageId) {
  return context.findIndex(
    (m) => m && (m.messageId === reportedMessageId || (m.roomMessageId && m.roomMessageId === reportedMessageId))
  );
}

async function run() {
  let getAllHistoryCallCount = 0;
  const originalGetAllHistory = messageStore.getAllHistory;
  messageStore.getAllHistory = function (...args) {
    getAllHistoryCallCount++;
    return originalGetAllHistory.apply(this, args);
  };

  try {
    // ─── 1) Anchor in middle (>=2 before, >=2 after) -> context length 5, anchor at index 2 ───
    await reportsStore.clear();
    const seeded = await seedMessages(CHAT_ID, 10);
    const sixthMessageId = seeded[5].messageId;
    const reportMiddle = await reportsStore.createReport({
      reporterUserId: 'rep1',
      reason: 'Spam',
      messageId: sixthMessageId,
      conversationId: CHAT_ID,
      senderId: SENDER,
    });

    const req1 = mockReq();
    req1.params = { id: reportMiddle.id };
    const res1 = mockRes();
    await adminController.getReportDetails(req1, res1, () => {});

    const out1 = res1.getOut();
    if (out1.statusCode !== 200) fail(`Case 1 expected 200, got ${out1.statusCode}`);
    const data1 = out1.body?.data;
    if (!data1) fail('Case 1: response must have data');
    if (!data1.report) fail('Case 1: data must have report');
    if (data1.message == null) fail('Case 1: message must be non-null when anchor exists');
    if (!Array.isArray(data1.context)) fail('Case 1: data.context must be array');
    if (data1.window !== 2) fail(`Case 1: window must be 2, got ${data1.window}`);

    if (data1.context.length > 5) {
      fail(`Case 1: context length must be <= 5, got ${data1.context.length}`);
    }
    if (data1.context.length !== 5) {
      fail(`Case 1: anchor in middle expected context length 5, got ${data1.context.length}. Context messageIds: ${data1.context.map((m) => m.messageId).join(', ')}`);
    }

    const anchorIdx1 = findAnchorIndex(data1.context, sixthMessageId);
    if (anchorIdx1 === -1) {
      fail(`Case 1: anchor message ${sixthMessageId} must appear in context. Context messageIds: ${data1.context.map((m) => m.messageId).join(', ')}`);
    }
    if (anchorIdx1 !== 2) {
      fail(`Case 1: anchor expected at index 2, got ${anchorIdx1}. Context messageIds: ${data1.context.map((m) => m.messageId).join(', ')}`);
    }

    assertContextChronological(data1.context);
    console.log('PASS: Anchor in middle -> context length 5, anchor at index 2, chronological');

    // ─── 2) Anchor near start -> context length < 5 but includes anchor ───
    const secondMessageId = seeded[1].messageId;
    const reportStart = await reportsStore.createReport({
      reporterUserId: 'rep1',
      reason: 'Spam',
      messageId: secondMessageId,
      conversationId: CHAT_ID,
      senderId: SENDER,
    });

    const req2 = mockReq();
    req2.params = { id: reportStart.id };
    const res2 = mockRes();
    await adminController.getReportDetails(req2, res2, () => {});

    const data2 = res2.getOut().body?.data;
    if (!data2 || !Array.isArray(data2.context)) fail('Case 2: data.context must be array');
    if (data2.context.length > 5) fail(`Case 2: context length must be <= 5, got ${data2.context.length}`);
    if (data2.context.length < 2) fail(`Case 2: expected at least 2 context messages (anchor + 1 after), got ${data2.context.length}`);

    const anchorIdx2 = findAnchorIndex(data2.context, secondMessageId);
    if (anchorIdx2 === -1) fail(`Case 2: anchor ${secondMessageId} must appear in context`);
    assertContextChronological(data2.context);
    console.log('PASS: Anchor near start -> context length < 5, includes anchor, chronological');

    // ─── 3) Anchor near end -> context length < 5 but includes anchor ───
    const ninthMessageId = seeded[8].messageId;
    const reportEnd = await reportsStore.createReport({
      reporterUserId: 'rep1',
      reason: 'Spam',
      messageId: ninthMessageId,
      conversationId: CHAT_ID,
      senderId: SENDER,
    });

    const req3 = mockReq();
    req3.params = { id: reportEnd.id };
    const res3 = mockRes();
    await adminController.getReportDetails(req3, res3, () => {});

    const data3 = res3.getOut().body?.data;
    if (!data3 || !Array.isArray(data3.context)) fail('Case 3: data.context must be array');
    if (data3.context.length > 5) fail(`Case 3: context length must be <= 5, got ${data3.context.length}`);
    const anchorIdx3 = findAnchorIndex(data3.context, ninthMessageId);
    if (anchorIdx3 === -1) fail(`Case 3: anchor ${ninthMessageId} must appear in context`);
    assertContextChronological(data3.context);
    console.log('PASS: Anchor near end -> context length < 5, includes anchor, chronological');

    // ─── 4) Anchor missing -> message: null, context: [], contextError: MESSAGE_NOT_FOUND ───
    const reportMissing = await reportsStore.createReport({
      reporterUserId: 'rep1',
      reason: 'Spam',
      messageId: 'msg_nonexistent_xyz',
      conversationId: CHAT_ID,
      senderId: SENDER,
    });

    const req4 = mockReq();
    req4.params = { id: reportMissing.id };
    const res4 = mockRes();
    await adminController.getReportDetails(req4, res4, () => {});

    const out4 = res4.getOut();
    if (out4.statusCode !== 200) fail(`Case 4 expected 200, got ${out4.statusCode}`);
    const data4 = out4.body?.data;
    if (data4.message !== null) fail(`Case 4: message must be null when anchor missing, got ${JSON.stringify(data4.message)}`);
    if (!Array.isArray(data4.context) || data4.context.length !== 0) {
      fail(`Case 4: context must be [], got length ${data4.context?.length}`);
    }
    if (data4.contextError !== 'MESSAGE_NOT_FOUND') {
      fail(`Case 4: contextError must be MESSAGE_NOT_FOUND, got ${data4.contextError}`);
    }
    if (data4.window !== 2) fail(`Case 4: window must be 2, got ${data4.window}`);
    console.log('PASS: Anchor missing -> message:null, context:[], contextError:MESSAGE_NOT_FOUND');

    // ─── 5) Dedup: room with duplicate roomMessageId -> context has no duplicate ───
    await reportsStore.clear();
    const roomId = 'room_ctx_' + Date.now();
    const { chatId: roomChatId, anchorMessageId: roomAnchorId } = await seedRoomWithDedup(roomId);
    const reportDedup = await reportsStore.createReport({
      reporterUserId: 'rep1',
      reason: 'Spam',
      messageId: roomAnchorId,
      conversationId: roomChatId,
      senderId: 'u2',
    });

    const req5 = mockReq();
    req5.params = { id: reportDedup.id };
    const res5 = mockRes();
    await adminController.getReportDetails(req5, res5, () => {});

    const data5 = res5.getOut().body?.data;
    if (!data5 || !Array.isArray(data5.context)) fail('Case 5: data.context must be array');
    if (data5.context.length > 5) fail(`Case 5: context length must be <= 5, got ${data5.context.length}`);

    const dedupKeys = data5.context.map((m) => m.roomMessageId || m.messageId);
    const seen = new Set();
    for (const k of dedupKeys) {
      if (seen.has(k)) fail(`Case 5: dedup violated - duplicate key ${k} in context`);
      seen.add(k);
    }
    assertContextChronological(data5.context);
    console.log('PASS: Dedup respected (roomMessageId duplicates collapsed)');

    // ─── 6) Backend returns > 5 context → clamped to 5 ───
    await reportsStore.clear();
    const clampChatId = 'direct:clamp_a:clamp_b';
    const clampSeeded = await seedMessages(clampChatId, 3, { prefix: 'msg_clamp' });
    const clampReport = await reportsStore.createReport({
      reporterUserId: 'rep1',
      reason: 'Spam',
      messageId: clampSeeded[1].messageId,
      conversationId: clampChatId,
      senderId: SENDER,
    });
    const originalGetContextWindow = messageStore.getContextWindow;
    const sevenContextItems = [
      { messageId: 'ctx_1', senderId: SENDER, recipientId: RECIPIENT, content: 'C1', timestamp: 1000, state: 'sent', roomId: null, roomMessageId: null },
      { messageId: 'ctx_2', senderId: SENDER, recipientId: RECIPIENT, content: 'C2', timestamp: 2000, state: 'sent', roomId: null, roomMessageId: null },
      { messageId: clampSeeded[1].messageId, senderId: SENDER, recipientId: RECIPIENT, content: 'Anchor', timestamp: 3000, state: 'sent', roomId: null, roomMessageId: null },
      { messageId: 'ctx_4', senderId: SENDER, recipientId: RECIPIENT, content: 'C4', timestamp: 4000, state: 'sent', roomId: null, roomMessageId: null },
      { messageId: 'ctx_5', senderId: SENDER, recipientId: RECIPIENT, content: 'C5', timestamp: 5000, state: 'sent', roomId: null, roomMessageId: null },
      { messageId: 'ctx_6', senderId: SENDER, recipientId: RECIPIENT, content: 'C6', timestamp: 6000, state: 'sent', roomId: null, roomMessageId: null },
      { messageId: 'ctx_7', senderId: SENDER, recipientId: RECIPIENT, content: 'C7', timestamp: 7000, state: 'sent', roomId: null, roomMessageId: null },
    ];
    const anchorForClamp = { messageId: clampSeeded[1].messageId, senderId: SENDER, recipientId: RECIPIENT, content: 'Anchor', timestamp: 3000, state: 'sent', roomId: null, roomMessageId: null };
    messageStore.getContextWindow = async () => ({ anchor: anchorForClamp, context: sevenContextItems });
    const reqClamp = mockReq();
    reqClamp.params = { id: clampReport.id };
    const resClamp = mockRes();
    await adminController.getReportDetails(reqClamp, resClamp, () => {});
    messageStore.getContextWindow = originalGetContextWindow;

    const outClamp = resClamp.getOut();
    if (outClamp.statusCode !== 200) fail(`Clamp case expected 200, got ${outClamp.statusCode}`);
    const dataClamp = outClamp.body?.data;
    if (!dataClamp || !Array.isArray(dataClamp.context)) fail('Clamp case: data.context must be array');
    if (dataClamp.context.length !== 5) {
      fail(`Clamp case: context must be clamped to 5, got ${dataClamp.context.length}`);
    }
    console.log('PASS: Backend returns > 5 ctx → clamped to 5');

    // ─── 7) getAllHistory is never called ───
    if (getAllHistoryCallCount !== 0) {
      fail(`getAllHistory must not be called; was called ${getAllHistoryCallCount} time(s)`);
    }
    console.log('PASS: getAllHistory was never called');

    // ─── Cleanup ───
    const toDelete = seeded.map((s) => s.messageId);
    await deleteTestMessages(toDelete);
    await deleteTestMessages(clampSeeded.map((s) => s.messageId));
    await deleteTestMessages(['msg_r1', 'msg_r2a', 'msg_r2b', 'msg_r3']);
    await reportsStore.clear();
  } finally {
    messageStore.getAllHistory = originalGetAllHistory;
  }

  console.log('\n✅ Admin report context-window tests passed');
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
