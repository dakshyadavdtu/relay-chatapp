'use strict';

/**
 * GET /api/admin/messages controller tests.
 * Run: node -r dotenv/config tests/admin/admin.messages.test.js (from backend)
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');
const adminController = require(path.join(backendRoot, 'http/controllers/admin.controller'));
const dbAdapter = require(path.join(backendRoot, 'config/db'));

const CONV_ID = 'direct:adm_msgs_a:adm_msgs_b';
const USER_A = 'adm_msgs_a';
const USER_B = 'adm_msgs_b';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function mockReq(user = { userId: 'adm_admin', role: 'ADMIN' }, overrides = {}) {
  return {
    user: user ? { ...user } : null,
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
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

/** Seed messages into a DM chat via db adapter (with chatId for getAllHistory). */
async function seedDmMessages(chatId, messages) {
  for (const m of messages) {
    await dbAdapter.persistMessage({
      messageId: m.messageId,
      senderId: m.senderId,
      recipientId: m.recipientId,
      content: m.content || 'x',
      timestamp: m.timestamp || Date.now(),
      state: 'sent',
      messageType: 'direct',
      chatId,
      clientMessageId: m.clientMessageId || `c_${m.messageId}`,
    });
  }
}

async function run() {
  try {
    // ─── 401 when unauthenticated ───
    const req401 = mockReq(null);
    req401.query = { conversationId: CONV_ID, limit: 10 };
    const res401 = mockRes();
    await adminController.getAdminMessages(req401, res401);
    const out401 = res401.getOut();
    if (out401.statusCode !== 401) fail(`Expected 401 when unauthenticated, got ${out401.statusCode}`);
    if (out401.body?.code !== 'UNAUTHORIZED') fail('Expected code UNAUTHORIZED');
    if (out401.body?.success !== false) fail('Expected success: false');
    console.log('PASS: 401 when unauthenticated');

    // ─── 403 when authenticated but not admin ───
    const req403 = mockReq({ userId: 'regular_user', role: 'USER' });
    req403.query = { conversationId: CONV_ID, limit: 10 };
    const res403 = mockRes();
    await adminController.getAdminMessages(req403, res403);
    const out403 = res403.getOut();
    if (out403.statusCode !== 403) fail(`Expected 403 when not admin, got ${out403.statusCode}`);
    if (out403.body?.code !== 'FORBIDDEN') fail('Expected code FORBIDDEN');
    if (out403.body?.success !== false) fail('Expected success: false');
    console.log('PASS: 403 when authenticated but not admin');

    // ─── 400 when missing conversationId ───
    const reqNoConv = mockReq();
    reqNoConv.query = { limit: 10 };
    const resNoConv = mockRes();
    await adminController.getAdminMessages(reqNoConv, resNoConv);
    const outNoConv = resNoConv.getOut();
    if (outNoConv.statusCode !== 400) fail(`Expected 400 when missing conversationId, got ${outNoConv.statusCode}`);
    if (outNoConv.body?.code !== 'INVALID_QUERY') fail('Expected code INVALID_QUERY');
    if (outNoConv.body?.success !== false) fail('Expected success: false');
    console.log('PASS: 400 when missing conversationId');

    // ─── 400 when missing limit ───
    const reqNoLimit = mockReq();
    reqNoLimit.query = { conversationId: CONV_ID };
    const resNoLimit = mockRes();
    await adminController.getAdminMessages(reqNoLimit, resNoLimit);
    const outNoLimit = resNoLimit.getOut();
    if (outNoLimit.statusCode !== 400) fail(`Expected 400 when missing limit, got ${outNoLimit.statusCode}`);
    if (outNoLimit.body?.code !== 'INVALID_QUERY') fail('Expected code INVALID_QUERY');
    console.log('PASS: 400 when missing limit');

    // ─── 400 when limit out of range ───
    const reqBadLimit = mockReq();
    reqBadLimit.query = { conversationId: CONV_ID, limit: 0 };
    const resBadLimit = mockRes();
    await adminController.getAdminMessages(reqBadLimit, resBadLimit);
    const outBadLimit = resBadLimit.getOut();
    if (outBadLimit.statusCode !== 400) fail(`Expected 400 when limit=0, got ${outBadLimit.statusCode}`);
    if (outBadLimit.body?.code !== 'INVALID_QUERY') fail('Expected code INVALID_QUERY');
    console.log('PASS: 400 when limit out of range (0)');

    const reqBadLimit101 = mockReq();
    reqBadLimit101.query = { conversationId: CONV_ID, limit: 101 };
    const resBadLimit101 = mockRes();
    await adminController.getAdminMessages(reqBadLimit101, resBadLimit101);
    const outBadLimit101 = resBadLimit101.getOut();
    if (outBadLimit101.statusCode !== 400) fail(`Expected 400 when limit=101, got ${outBadLimit101.statusCode}`);
    console.log('PASS: 400 when limit out of range (101)');

    // ─── Seed messages for 200 tests ───
    await dbAdapter.clearStore();
    const ts = Date.now();
    await seedDmMessages(CONV_ID, [
      { messageId: 'adm_m1', senderId: USER_A, recipientId: USER_B, content: 'm1', timestamp: ts },
      { messageId: 'adm_m2', senderId: USER_B, recipientId: USER_A, content: 'm2', timestamp: ts + 1 },
      { messageId: 'adm_m3', senderId: USER_A, recipientId: USER_B, content: 'm3', timestamp: ts + 2 },
      { messageId: 'adm_m4', senderId: USER_B, recipientId: USER_A, content: 'm4', timestamp: ts + 3 },
      { messageId: 'adm_m5', senderId: USER_A, recipientId: USER_B, content: 'm5', timestamp: ts + 4 },
    ]);

    // ─── 200 for admin: returns messages array, respects limit ───
    const req200 = mockReq();
    req200.query = { conversationId: CONV_ID, limit: 50 };
    const res200 = mockRes();
    await adminController.getAdminMessages(req200, res200);
    const out200 = res200.getOut();
    if (out200.statusCode !== 200) fail(`Expected 200 for admin, got ${out200.statusCode}`);
    if (!out200.body?.success) fail('Expected success: true');
    const data = out200.body?.data;
    if (!data) fail('Expected data');
    if (!Array.isArray(data.messages)) fail('Expected data.messages array');
    if (data.conversationId !== CONV_ID) fail(`Expected conversationId ${CONV_ID}, got ${data.conversationId}`);
    if (data.messages.length !== 5) fail(`Expected 5 messages, got ${data.messages.length}`);
    const firstMsg = data.messages[0];
    if (!firstMsg || typeof firstMsg.id === 'undefined' || !firstMsg.senderId || firstMsg.content === undefined) {
      fail('Each message must have id, senderId, content (API shape)');
    }
    console.log('PASS: 200 for admin, returns messages array and API shape');

    // ─── Respects limit ───
    const reqLimit = mockReq();
    reqLimit.query = { conversationId: CONV_ID, limit: 2 };
    const resLimit = mockRes();
    await adminController.getAdminMessages(reqLimit, resLimit);
    const outLimit = resLimit.getOut();
    if (outLimit.statusCode !== 200) fail(`Expected 200, got ${outLimit.statusCode}`);
    if (outLimit.body?.data?.messages?.length !== 2) {
      fail(`Expected 2 messages when limit=2, got ${outLimit.body?.data?.messages?.length}`);
    }
    if (outLimit.body?.data?.hasMore !== true) fail('Expected hasMore: true when more messages exist');
    if (!outLimit.body?.data?.nextCursor) fail('Expected nextCursor when hasMore');
    console.log('PASS: respects limit and returns nextCursor/hasMore correctly');

    // ─── Pagination with before returns next page ───
    const nextCursor = outLimit.body.data.nextCursor;
    const reqPage2 = mockReq();
    reqPage2.query = { conversationId: CONV_ID, limit: 10, before: nextCursor };
    const resPage2 = mockRes();
    await adminController.getAdminMessages(reqPage2, resPage2);
    const outPage2 = resPage2.getOut();
    if (outPage2.statusCode !== 200) fail(`Expected 200 for page 2, got ${outPage2.statusCode}`);
    if (outPage2.body?.data?.messages?.length !== 3) {
      fail(`Expected 3 messages on page 2, got ${outPage2.body?.data?.messages?.length}`);
    }
    if (outPage2.body?.data?.hasMore !== false) fail('Expected hasMore: false on last page');
    if (outPage2.body?.data?.nextCursor !== null) fail('Expected nextCursor null on last page');
    console.log('PASS: pagination with before returns next page');

    // ─── senderId filter works ───
    const reqFilter = mockReq();
    reqFilter.query = { conversationId: CONV_ID, limit: 50, senderId: USER_A };
    const resFilter = mockRes();
    await adminController.getAdminMessages(reqFilter, resFilter);
    const outFilter = resFilter.getOut();
    if (outFilter.statusCode !== 200) fail(`Expected 200 with senderId filter, got ${outFilter.statusCode}`);
    const filtered = outFilter.body?.data?.messages || [];
    if (filtered.length !== 3) fail(`Expected 3 messages from USER_A, got ${filtered.length}`);
    if (filtered.some((m) => m.senderId !== USER_A)) fail('All messages must have senderId === USER_A');
    console.log('PASS: senderId filter works');

    console.log('\n✅ Admin messages API tests passed');
  } finally {
    await dbAdapter.clearStore();
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
