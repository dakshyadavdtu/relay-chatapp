'use strict';

/**
 * Reports controller - user-submitted abuse/moderation reports.
 * POST /api/reports - create a report (auth required).
 */

const reportsStore = require('../../storage/reports.store');
const messageStore = require('../../services/message.store');
const userStoreStorage = require('../../storage/user.store');
const { sendError, sendSuccess } = require('../../utils/errorResponse');
const adminActivityBuffer = require('../../observability/adminActivityBuffer');
const { validateOptionalString, validateOptionalId, validateCategory } = require('../../utils/adminValidation');
const { toRoomId, toDirectChatId, normalizeRoomId } = require('../../utils/chatId');
const { getClientIpFromReq } = require('../../utils/ip');
const logger = require('../../utils/logger');
const suspiciousDetector = require('../../suspicious/suspicious.detector');

const MAX_BODY_BYTES = 4096;

// Report threshold: flag when target has >= COUNT reports in WINDOW (crossing only). Never throw; fallback defaults.
const REPORT_THRESHOLD_WINDOW_MS = (() => {
  try {
    const minMs = 5 * 60 * 1000;
    const maxMs = 30 * 24 * 60 * 60 * 1000;
    const envHours = process.env.REPORT_THRESHOLD_WINDOW_HOURS;
    if (envHours != null && envHours !== '') {
      const h = parseFloat(envHours);
      if (Number.isFinite(h) && h > 0) {
        const ms = h * 60 * 60 * 1000;
        return Math.min(maxMs, Math.max(minMs, ms));
      }
    }
    return 6 * 60 * 60 * 1000;
  } catch (_) {
    return 6 * 60 * 60 * 1000;
  }
})();
const REPORT_THRESHOLD_COUNT = (() => {
  try {
    const env = process.env.REPORT_THRESHOLD_COUNT;
    if (env != null && env !== '') {
      const n = parseInt(env, 10);
      if (Number.isInteger(n) && n > 0) return n;
    }
    return 3;
  } catch (_) {
    return 3;
  }
})();

/** Max length for conversationId (e.g. group-xxx or dm-xxx). */
const MAX_CONVERSATION_ID_LEN = 256;

/**
 * POST /api/reports
 * User report: { targetUserId, reason, details? }
 * Message report: { messageId, conversationId, senderId, reason, details? }
 * Auth required. Rate limited (10/hour per user).
 */
async function createReport(req, res) {
  const userId = req.user?.userId;
  if (!userId) {
    return sendError(res, 401, 'Authentication required', 'UNAUTHORIZED');
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    logger.warn('Reports', 'create_report_invalid_body', { userId });
    return sendError(res, 400, 'Request body must be a JSON object', 'INVALID_PAYLOAD');
  }
  const bodyStr = JSON.stringify(body);
  if (Buffer.byteLength(bodyStr, 'utf8') > MAX_BODY_BYTES) {
    logger.warn('Reports', 'create_report_payload_too_large', { userId, size: bodyStr.length });
    return sendError(res, 413, 'Request body too large', 'PAYLOAD_TOO_LARGE');
  }

  const reason = body.reason;
  if (reason === undefined || reason === null) {
    logger.warn('Reports', 'create_report_missing_reason', { userId });
    return sendError(res, 400, 'reason is required', 'INVALID_PAYLOAD');
  }
  if (typeof reason !== 'string') {
    return sendError(res, 400, 'reason must be a string', 'INVALID_PAYLOAD');
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    logger.warn('Reports', 'create_report_empty_reason', { userId });
    return sendError(res, 400, 'reason cannot be empty', 'INVALID_PAYLOAD');
  }

  const targetRes = validateOptionalId(body.targetUserId);
  if (!targetRes.ok) {
    logger.warn('Reports', 'create_report_invalid_target', { userId, error: targetRes.error });
    return sendError(res, 400, targetRes.error, targetRes.code);
  }
  const messageRes = validateOptionalId(body.messageId);
  if (!messageRes.ok) {
    logger.warn('Reports', 'create_report_invalid_message_id', { userId, error: messageRes.error });
    return sendError(res, 400, messageRes.error, messageRes.code);
  }
  const conversationRes = validateOptionalId(body.conversationId, MAX_CONVERSATION_ID_LEN);
  if (!conversationRes.ok) {
    logger.warn('Reports', 'create_report_invalid_conversation_id', { userId, error: conversationRes.error });
    return sendError(res, 400, conversationRes.error, conversationRes.code);
  }
  const senderRes = validateOptionalId(body.senderId);
  if (!senderRes.ok) {
    logger.warn('Reports', 'create_report_invalid_sender_id', { userId, error: senderRes.error });
    return sendError(res, 400, senderRes.error, senderRes.code);
  }
  const detailsRes = validateOptionalString(body.details, 2000);
  if (!detailsRes.ok) {
    return sendError(res, 400, detailsRes.error, detailsRes.code);
  }
  if (body.priority !== undefined && body.priority !== null) {
    logger.warn('Reports', 'create_report_priority_ignored', { userId });
    return sendError(res, 400, 'priority is not accepted; it is derived from category', 'INVALID_PAYLOAD');
  }
  const categoryRes = validateCategory(body.category);
  if (!categoryRes.ok) {
    logger.warn('Reports', 'create_report_invalid_category', { userId, error: categoryRes.error });
    return sendError(res, 400, categoryRes.error, categoryRes.code);
  }

  const isMessageReport = messageRes.value != null && messageRes.value !== '';
  const isUserReport = targetRes.value != null && targetRes.value !== '';

  if (isMessageReport) {
    if (!conversationRes.value || !senderRes.value) {
      logger.warn('Reports', 'create_report_message_missing_context', { userId });
      return sendError(res, 400, 'messageId requires conversationId and senderId for message reports', 'INVALID_PAYLOAD');
    }

    const messageId = messageRes.value;
    const conversationId = conversationRes.value;
    const senderId = senderRes.value;

    const msg = await messageStore.getById(messageId);
    if (!msg) {
      logger.warn('Reports', 'create_report_message_not_found', { userId, messageId });
      return sendError(res, 400, 'Invalid messageId', 'MESSAGE_NOT_FOUND');
    }

    const msgChatId = msg.chatId != null ? String(msg.chatId).trim() : '';
    const msgRoomId = msg.roomId != null ? String(msg.roomId).trim() : '';

    if (msgChatId !== '') {
      if (msgChatId !== conversationId) {
        logger.warn('Reports', 'create_report_conversation_mismatch', { userId, messageId });
        return sendError(res, 400, 'Message does not belong to this conversation', 'MESSAGE_CONVERSATION_MISMATCH');
      }
    } else if (msgRoomId !== '') {
      const msgRoom = normalizeRoomId(msg.roomId);
      const reqRoom = toRoomId(conversationId);
      if (reqRoom === null || reqRoom !== msgRoom) {
        logger.warn('Reports', 'create_report_conversation_mismatch', { userId, messageId });
        return sendError(res, 400, 'Message does not belong to this conversation', 'MESSAGE_CONVERSATION_MISMATCH');
      }
    } else if (msg.senderId != null && msg.recipientId != null) {
      const directId = toDirectChatId(msg.senderId, msg.recipientId);
      if (directId === '' || conversationId !== directId) {
        logger.warn('Reports', 'create_report_conversation_mismatch', { userId, messageId });
        return sendError(res, 400, 'Message does not belong to this conversation', 'MESSAGE_CONVERSATION_MISMATCH');
      }
    } else {
      logger.warn('Reports', 'create_report_no_chat_binding', { userId, messageId });
      return sendError(res, 400, 'Message is missing chat binding', 'MESSAGE_NO_CHAT_BINDING');
    }

    const msgSender = msg.senderId != null ? String(msg.senderId) : '';
    if (msgSender !== senderId) {
      logger.warn('Reports', 'create_report_sender_mismatch', { userId, messageId });
      return sendError(res, 400, 'senderId does not match message sender', 'SENDER_MISMATCH');
    }

    logger.info('Reports', 'create_message_report_validated', {
      reporterUserId: userId,
      messageId,
      conversationId,
      senderId,
    });
  } else {
    if (!isUserReport) {
      logger.warn('Reports', 'create_report_neither_user_nor_message', { userId });
      return sendError(res, 400, 'Either targetUserId (user report) or messageId + conversationId + senderId (message report) is required', 'INVALID_PAYLOAD');
    }
  }

  try {
    const reporterIp = getClientIpFromReq(req) ?? null;
    let reporterAccountCreatedAt = null;
    try {
      const reporterUser = await userStoreStorage.findById(userId);
      if (reporterUser && typeof reporterUser.createdAt === 'number') {
        reporterAccountCreatedAt = reporterUser.createdAt;
      }
    } catch (_) { /* ignore */ }
    const payload = {
      reporterUserId: userId,
      reason: trimmedReason,
      details: detailsRes.value,
      category: categoryRes.value,
      ...(reporterIp && { reporterIp }),
      ...(reporterAccountCreatedAt != null && { reporterAccountCreatedAt }),
    };
    if (isMessageReport) {
      payload.messageId = messageRes.value;
      payload.conversationId = conversationRes.value;
      payload.senderId = senderRes.value;
    } else {
      payload.targetUserId = targetRes.value;
    }
    const record = await reportsStore.createReport(payload);
    logger.info('Reports', 'report_created', {
      reportId: record.id,
      reporterUserId: userId,
      targetUserId: record.targetUserId ?? null,
      type: record.type,
      timestamp: Date.now(),
    });
    try {
      adminActivityBuffer.recordEvent({
        type: 'report',
        title: 'New report created',
        detail: `Report ${record.id}`,
        severity: 'info',
      });
    } catch (_) { /* no-op */ }

    try {
      const targetUserId = record.targetUserId;
      if (targetUserId && typeof targetUserId === 'string') {
        const sinceTs = Date.now() - REPORT_THRESHOLD_WINDOW_MS;
        const recentCount = await reportsStore.countRecentByTargetUser(targetUserId, sinceTs);
        if (recentCount === REPORT_THRESHOLD_COUNT) {
          suspiciousDetector.recordFlag(targetUserId, 'REPORT_THRESHOLD', {
            lastDetail: `count=${recentCount}/${REPORT_THRESHOLD_COUNT} windowHours=${REPORT_THRESHOLD_WINDOW_MS / 3600000} reportId=${record.id} reason=${record.reason || ''} type=${record.type || ''}`,
          });
          logger.warn('Reports', 'report_threshold_flagged', { targetUserId, recentCount, reportId: record.id });
        }
      }
    } catch (err) {
      logger.warn('Reports', 'report_threshold_check_error', { error: err?.message || String(err), reportId: record?.id });
    }

    return sendSuccess(res, {
      id: record.id,
      createdAt: record.createdAt,
      status: record.status,
    }, 201);
  } catch (err) {
    if (err.code === 'INVALID_PAYLOAD') {
      return sendError(res, 400, err.message, 'INVALID_PAYLOAD');
    }
    if (err.code === 'PAYLOAD_TOO_LARGE') {
      return sendError(res, 400, err.message, 'PAYLOAD_TOO_LARGE');
    }
    throw err;
  }
}

module.exports = {
  createReport,
};
