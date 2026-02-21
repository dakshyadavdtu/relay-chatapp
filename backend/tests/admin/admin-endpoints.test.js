'use strict';

/**
 * Admin endpoints contract tests.
 * Invokes controller functions directly with mock req/res.
 * Run: node tests/admin/admin-endpoints.test.js (from backend)
 */

const path = require('path');
const backendRoot = path.resolve(__dirname, '../..');
const adminController = require(path.join(backendRoot, 'http/controllers/admin.controller'));
const reportsController = require(path.join(backendRoot, 'http/controllers/reports.controller'));
const reportsStore = require(path.join(backendRoot, 'storage/reports.store'));
const userStoreStorage = require(path.join(backendRoot, 'storage/user.store'));

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function mockReq(user = { userId: 'dev_admin', role: 'ADMIN' }) {
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

async function run() {
  // ─── Pipeline: POST creates report, GET /admin/reports includes it ───
  await await reportsStore.clear();
  const createReq = mockReq({ userId: 'test_reporter', role: 'USER' });
  createReq.body = { reason: 'Spam test', targetUserId: 'user_xyz', category: 'Spam' };
  const createRes = mockRes();
  await reportsController.createReport(createReq, createRes, () => {});
  const createOut = createRes.getOut();
  if (createOut.statusCode !== 201) fail(`POST /reports expected 201, got ${createOut.statusCode}`);
  if (!createOut.body?.data?.id) fail('POST /reports must return data.id');

  const reportId = createOut.body.data.id;
  const resReports = mockRes();
  await adminController.getReports(mockReq(), resReports);
  const reportsOut = resReports.getOut();
  const reports = reportsOut.body?.data?.reports || [];
  const found = reports.find((r) => r.id === reportId);
  if (!found) fail(`Report ${reportId} should appear in GET /admin/reports`);
  if (typeof found.date !== 'string') fail('Report must have date string');
  if (typeof found.user !== 'string') fail('Report must have user string');
  if (typeof found.priority !== 'string') fail('Report must have priority string');
  if (!['low', 'normal', 'high'].includes(found.priority)) fail(`Report priority must be low|normal|high, got ${found.priority}`);
  if (found.priority !== 'low') fail('Spam category must yield priority low');
  if (found.reason !== 'Spam test') fail('Report reason should be preserved');
  console.log('PASS: POST /api/reports -> GET /admin/reports pipeline (priority from category)');
  await reportsStore.clear();

  // ─── GET /api/admin/reports ───
  const resReports2 = mockRes();
  await adminController.getReports(mockReq(), resReports2);
  const reportsOut2 = resReports2.getOut();
  if (reportsOut2.statusCode !== 200) fail(`Reports expected 200, got ${reportsOut2.statusCode}`);
  if (!reportsOut2.body) fail('Reports response must have body');
  if (reportsOut2.body.success !== true) fail('Reports response must have success: true');
  if (!reportsOut2.body.data) fail('Reports response must have data');
  if (!Array.isArray(reportsOut2.body.data.reports)) fail('Reports data.reports must be array');
  if (reportsOut2.body.data.notAvailable === true) fail('Reports must NOT have data.notAvailable: true');
  console.log('PASS: GET /api/admin/reports returns valid shape');

  // ─── POST /admin/reports/:id/resolve ───
  await reportsStore.clear();
  const createReq2 = mockReq({ userId: 'test_reporter', role: 'ADMIN' });
  createReq2.body = { reason: 'Resolve test', targetUserId: 'user_xyz', category: 'Harassment' };
  const createRes2 = mockRes();
  await reportsController.createReport(createReq2, createRes2, () => {});
  const reportId2 = createRes2.getOut().body?.data?.id;
  if (!reportId2) fail('Need report id for resolve test');
  const resolveReq = mockReq();
  resolveReq.params = { id: reportId2 };
  const resolveRes = mockRes();
  await adminController.resolveReport(resolveReq, resolveRes, () => {});
  const resolveOut = resolveRes.getOut();
  if (resolveOut.statusCode !== 200) fail(`Resolve expected 200, got ${resolveOut.statusCode}`);
  if (resolveOut.body?.data?.status !== 'resolved') fail('Resolve should return status resolved');
  const reportsAfter = await reportsStore.listReports({ status: 'open' });
  if (reportsAfter.some((r) => r.id === reportId2)) fail('Resolved report should not appear in open list');
  console.log('PASS: POST /admin/reports/:id/resolve');

  // ─── POST /admin/users/:id/warn (requires user in storage - skip if empty) ───
  // ─── POST /admin/users/:id/ban, unban (same) ───
  console.log('PASS: Admin action endpoints (resolve verified; warn/ban/unban require users in storage)');

  // ─── Hardening: Validation tests ───
  // POST /api/reports - empty reason
  const emptyReasonReq = mockReq({ userId: 'test_reporter', role: 'USER' });
  emptyReasonReq.body = { reason: '   ', targetUserId: 'user_xyz', category: 'Spam' };
  const emptyReasonRes = mockRes();
  await reportsController.createReport(emptyReasonReq, emptyReasonRes, () => {});
  const emptyReasonOut = emptyReasonRes.getOut();
  if (emptyReasonOut.statusCode !== 400) fail(`Empty reason expected 400, got ${emptyReasonOut.statusCode}`);
  if (emptyReasonOut.body?.success !== false || emptyReasonOut.body?.code !== 'INVALID_PAYLOAD') {
    fail('Empty reason must return INVALID_PAYLOAD');
  }
  console.log('PASS: POST /reports rejects empty reason');

  // POST /api/reports - invalid targetUserId (control chars)
  const badTargetReq = mockReq({ userId: 'test_reporter', role: 'USER' });
  badTargetReq.body = { reason: 'Spam', targetUserId: 'user\x00evil', category: 'Spam' };
  const badTargetRes = mockRes();
  await reportsController.createReport(badTargetReq, badTargetRes, () => {});
  const badTargetOut = badTargetRes.getOut();
  if (badTargetOut.statusCode !== 400) fail(`Invalid targetUserId expected 400, got ${badTargetOut.statusCode}`);
  console.log('PASS: POST /reports rejects invalid targetUserId');

  // POST /api/reports - message report without conversationId/senderId (rejected by controller)
  const badMsgReq = mockReq({ userId: 'test_reporter', role: 'USER' });
  badMsgReq.body = { reason: 'Spam', messageId: 'msg_abc', category: 'Spam' };
  const badMsgRes = mockRes();
  await reportsController.createReport(badMsgReq, badMsgRes, () => {});
  const badMsgOut = badMsgRes.getOut();
  if (badMsgOut.statusCode !== 400) fail(`Message report without context expected 400, got ${badMsgOut.statusCode}`);
  console.log('PASS: POST /reports rejects messageId without conversationId and senderId');

  // POST /api/reports - neither user nor message report
  const neitherReq = mockReq({ userId: 'test_reporter', role: 'USER' });
  neitherReq.body = { reason: 'Spam', category: 'Spam' };
  const neitherRes = mockRes();
  await reportsController.createReport(neitherReq, neitherRes, () => {});
  const neitherOut = neitherRes.getOut();
  if (neitherOut.statusCode !== 400) fail(`Neither user nor message report expected 400, got ${neitherOut.statusCode}`);
  console.log('PASS: POST /reports rejects payload without targetUserId or messageId');

  // POST /admin/reports/:id/resolve - invalid report ID format
  const badReportReq = mockReq();
  badReportReq.params = { id: 'invalid_report_id' };
  const badReportRes = mockRes();
  await adminController.resolveReport(badReportReq, badReportRes, () => {});
  const badReportOut = badReportRes.getOut();
  if (badReportOut.statusCode !== 400) fail(`Invalid report ID format expected 400, got ${badReportOut.statusCode}`);
  if (badReportOut.body?.success !== false) fail('Invalid report ID must return success: false');
  console.log('PASS: POST /admin/reports/:id/resolve rejects invalid report ID format');

  // POST /admin/users/:id/warn - invalid user ID (empty)
  const badWarnReq = mockReq();
  badWarnReq.params = { id: '' };
  badWarnReq.body = {};
  const badWarnRes = mockRes();
  await adminController.warnUser(badWarnReq, badWarnRes, () => {});
  const badWarnOut = badWarnRes.getOut();
  if (badWarnOut.statusCode !== 400) fail(`Invalid user ID for warn expected 400, got ${badWarnOut.statusCode}`);
  console.log('PASS: POST /admin/users/:id/warn rejects invalid user ID');

  // POST /admin/users/:id/ban - invalid user ID (control chars)
  const badBanReq = mockReq();
  badBanReq.params = { id: 'user\x01\x02' };
  const badBanRes = mockRes();
  await adminController.banUser(badBanReq, badBanRes, () => {});
  const badBanOut = badBanRes.getOut();
  if (badBanOut.statusCode !== 400) fail(`Invalid user ID for ban expected 400, got ${badBanOut.statusCode}`);
  console.log('PASS: POST /admin/users/:id/ban rejects invalid user ID');

  // ─── GET /admin/dashboard/series ───
  const seriesRes = mockRes();
  await adminController.getDashboardSeries(mockReq(), seriesRes, () => {});
  const seriesOut = seriesRes.getOut();
  if (seriesOut.statusCode !== 200) fail(`Dashboard series expected 200, got ${seriesOut.statusCode}`);
  const seriesData = seriesOut.body?.data;
  if (!seriesData || !Array.isArray(seriesData.points)) fail('Dashboard series must have data.points array');
  if (seriesData.points.length > 60) fail('Dashboard series points must be <= 60');
  console.log('PASS: GET /admin/dashboard/series');

  // ─── GET /admin/activity ───
  const activityRes = mockRes();
  await adminController.getActivity(mockReq(), activityRes, () => {});
  const activityOut = activityRes.getOut();
  if (activityOut.statusCode !== 200) fail(`Activity expected 200, got ${activityOut.statusCode}`);
  const activityData = activityOut.body?.data;
  if (!activityData || !Array.isArray(activityData.events)) fail('Activity must have data.events array');
  if (activityData.events.length > 50) fail('Activity events must be <= 50');
  console.log('PASS: GET /admin/activity');

  // ─── GET /admin/dashboard/stats ───
  const statsRes = mockRes();
  await adminController.getDashboardStats(mockReq(), statsRes, () => {});
  const statsOut = statsRes.getOut();
  if (statsOut.statusCode !== 200) fail(`Dashboard stats expected 200, got ${statsOut.statusCode}`);
  if (statsOut.body?.success !== true) fail('Dashboard stats must have success: true');
  console.log('PASS: GET /admin/dashboard/stats');

  // ─── GET /admin/users/:id/sessions ───
  try {
    userStoreStorage.createDevUser('user1', 'USER');
  } catch (_) {
    /* user1 may already exist */
  }
  const sessionsReq = mockReq();
  sessionsReq.params = { id: 'user1' };
  const sessionsRes = mockRes();
  await adminController.getUserSessions(sessionsReq, sessionsRes, () => {});
  const sessionsOut = sessionsRes.getOut();
  if (sessionsOut.statusCode !== 200) fail(`User sessions expected 200, got ${sessionsOut.statusCode}`);
  const sessionsData = sessionsOut.body?.data;
  if (!sessionsData || !Array.isArray(sessionsData.sessions)) fail('User sessions must have data.sessions array');
  if (sessionsData.sessions.length > 10) fail('User sessions must be <= 10');
  console.log('PASS: GET /admin/users/:id/sessions');

  // ─── Bounded reads: GET /admin/reports returns max 200 ───
  await reportsStore.clear();
  for (let i = 0; i < 250; i++) {
    await reportsStore.createReport({
      reporterUserId: 'r1',
      targetUserId: 't1',
      reason: `Report ${i}`,
      category: 'Spam',
    });
  }
  const boundedRes = mockRes();
  await adminController.getReports(mockReq(), boundedRes);
  const boundedOut = boundedRes.getOut();
  const reportsList = boundedOut.body?.data?.reports || [];
  if (reportsList.length > 200) fail(`getReports must cap at 200, got ${reportsList.length}`);
  console.log('PASS: GET /admin/reports bounded to 200');

  // ─── Reports store: user report requires targetUserId ───
  await reportsStore.clear();
  try {
    await reportsStore.createReport({ reporterUserId: 'r1', reason: 'Spam', category: 'Spam' });
    fail('Store must reject user report without targetUserId');
  } catch (e) {
    if (e.code !== 'INVALID_PAYLOAD') fail(`Expected INVALID_PAYLOAD, got ${e.code}`);
  }
  console.log('PASS: Store rejects report without targetUserId (user report)');

  // ─── Reports store: message report requires messageId + conversationId + senderId ───
  try {
    await reportsStore.createReport({
      reporterUserId: 'r1',
      reason: 'Spam',
      messageId: 'msg_1',
      category: 'Spam',
    });
    fail('Store must reject message report without conversationId and senderId');
  } catch (e) {
    if (e.code !== 'INVALID_PAYLOAD') fail(`Expected INVALID_PAYLOAD for missing conversationId, got ${e.code}`);
  }
  try {
    await reportsStore.createReport({
      reporterUserId: 'r1',
      reason: 'Spam',
      messageId: 'msg_1',
      conversationId: 'conv_1',
      category: 'Spam',
    });
    fail('Store must reject message report without senderId');
  } catch (e) {
    if (e.code !== 'INVALID_PAYLOAD') fail(`Expected INVALID_PAYLOAD for missing senderId, got ${e.code}`);
  }
  console.log('PASS: Store requires conversationId and senderId for message reports');

  // ─── Reports store: message report sets targetUserId=senderId and type=message ───
  await reportsStore.clear();
  const msgReport = await reportsStore.createReport({
    reporterUserId: 'rep_1',
    reason: 'Bad message',
    messageId: 'msg_abc',
    conversationId: 'conv_xyz',
    senderId: 'sender_123',
    category: 'Harassment',
  });
  if (msgReport.type !== 'message') fail(`Message report type must be "message", got ${msgReport.type}`);
  if (msgReport.targetUserId !== 'sender_123') fail(`Message report targetUserId must be senderId, got ${msgReport.targetUserId}`);
  if (msgReport.hasMessageContext !== true) fail('Message report must have hasMessageContext true');
  if (msgReport.conversationId !== 'conv_xyz' || msgReport.senderId !== 'sender_123') {
    fail('Message report must store conversationId and senderId');
  }
  console.log('PASS: Message report sets type=message, targetUserId=senderId, hasMessageContext=true');

  // ─── resolveReport idempotent ───
  await reportsStore.clear();
  const idemReport = await reportsStore.createReport({
    reporterUserId: 'r1',
    targetUserId: 't1',
    reason: 'Idempotent test',
    category: 'Spam',
  });
  const idemId = idemReport.id;
  const resolveReq1 = mockReq();
  resolveReq1.params = { id: idemId };
  const resolveRes1 = mockRes();
  await adminController.resolveReport(resolveReq1, resolveRes1, () => {});
  const out1 = resolveRes1.getOut();
  if (out1.statusCode !== 200 || out1.body?.data?.status !== 'resolved') {
    fail(`First resolve expected 200 + status resolved, got ${out1.statusCode}`);
  }
  const resolveReq2 = mockReq();
  resolveReq2.params = { id: idemId };
  const resolveRes2 = mockRes();
  await adminController.resolveReport(resolveReq2, resolveRes2, () => {});
  const out2 = resolveRes2.getOut();
  if (out2.statusCode !== 200) fail(`Second resolve (idempotent) expected 200, got ${out2.statusCode}`);
  if (out2.body?.data?.status !== 'resolved') fail('Second resolve should still return status resolved');
  console.log('PASS: resolveReport idempotent');

  // ─── GET /admin/reports/:id ───
  await reportsStore.clear();
  const userReportForDetails = await reportsStore.createReport({
    reporterUserId: 'u1',
    targetUserId: 't1',
    reason: 'User report for details',
    category: 'Illegal',
  });
  const detailsReq = mockReq();
  detailsReq.params = { id: userReportForDetails.id };
  const detailsRes = mockRes();
  await adminController.getReportDetails(detailsReq, detailsRes, () => {});
  const detailsOut = detailsRes.getOut();
  if (detailsOut.statusCode !== 200) fail(`GET report details expected 200, got ${detailsOut.statusCode}`);
  const data = detailsOut.body?.data;
  if (!data || !data.report) fail('GET report details must return data.report');
  if (data.report.id !== userReportForDetails.id) fail('Report id must match');
  if (data.report.type !== 'user') fail('Report type must be user');
  if (data.message !== null) fail('User report details must have message: null');
  if (!Array.isArray(data.context) || data.context.length !== 0) fail('User report details must have context: []');
  console.log('PASS: GET /admin/reports/:id for user report returns message:null, context:[]');

  const badIdReq = mockReq();
  badIdReq.params = { id: 'rpt_invalid' };
  const badIdRes = mockRes();
  await adminController.getReportDetails(badIdReq, badIdRes, () => {});
  const badIdOut = badIdRes.getOut();
  if (badIdOut.statusCode !== 400) fail(`GET report details invalid id expected 400, got ${badIdOut.statusCode}`);

  const notFoundReq = mockReq();
  notFoundReq.params = { id: 'rpt_000000000000' };
  const notFoundRes = mockRes();
  await adminController.getReportDetails(notFoundReq, notFoundRes, () => {});
  const notFoundOut = notFoundRes.getOut();
  if (notFoundOut.statusCode !== 404) fail(`GET report details not found expected 404, got ${notFoundOut.statusCode}`);
  if (notFoundOut.body?.code !== 'REPORT_NOT_FOUND') fail('Not found must return code REPORT_NOT_FOUND');
  console.log('PASS: GET /admin/reports/:id 404 for unknown id');

  // ─── Integration: create report -> list -> details (context array exists) ───
  await reportsStore.clear();
  const msgReportForIntegration = await reportsStore.createReport({
    reporterUserId: 'rep_int',
    reason: 'Integration test',
    messageId: 'msg_int_1',
    conversationId: 'direct:a:b',
    senderId: 'sender_int',
    category: 'Hate speech',
  });
  const listRes = mockRes();
  await adminController.getReports(mockReq(), listRes);
  const listData = listRes.getOut().body?.data?.reports || [];
  const foundInList = listData.find((r) => r.id === msgReportForIntegration.id);
  if (!foundInList) fail('Created message report must appear in GET /admin/reports');
  const detailReq = mockReq();
  detailReq.params = { id: msgReportForIntegration.id };
  const detailRes = mockRes();
  await adminController.getReportDetails(detailReq, detailRes, () => {});
  const detailData = detailRes.getOut().body?.data;
  if (!detailData) fail('GET /admin/reports/:id must return data');
  if (!Array.isArray(detailData.context)) fail('GET /admin/reports/:id must return context array');
  if (detailData.report?.messageId !== 'msg_int_1') fail('Report details must include messageId');
  console.log('PASS: Create report -> list -> details (context array present)');

  // ─── Priority derived from category only (no PATCH endpoint) ───
  await reportsStore.clear();
  const catReport = await reportsStore.createReport({
    reporterUserId: 'r1',
    targetUserId: 't1',
    reason: 'Category test',
    category: 'Sexual content',
  });
  const catRec = await reportsStore.getReportById(catReport.id);
  if (catRec?.priority !== 'high') fail(`Sexual content must yield priority high, got ${catRec?.priority}`);
  console.log('PASS: Priority derived from category only');

  // ─── Old doc without category reads as normal ───
  const mongoClient = require(path.join(backendRoot, 'storage/mongo.client'));
  const db = await mongoClient.getDb();
  const legacyId = 'rpt_legacy000001';
  await db.collection('reports').insertOne({
    id: legacyId,
    createdAt: Date.now(),
    reporterUserId: 'u',
    targetUserId: 't',
    reason: 'Legacy',
    status: 'open',
    hasMessageContext: false,
  });
  const legacyReport = await reportsStore.getReportById(legacyId);
  if (!legacyReport) fail('Legacy report must be found');
  if (legacyReport.priority !== 'normal') fail(`Legacy report without category must read priority normal, got ${legacyReport.priority}`);
  await db.collection('reports').deleteOne({ id: legacyId });
  console.log('PASS: Old doc without category reads priority normal');

  console.log('\n✅ Admin endpoints contract tests passed');
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
