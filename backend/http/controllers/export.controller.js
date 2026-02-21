'use strict';

/**
 * Export chat history as JSON or PDF. Requires auth and chat ownership.
 */

const PDFDocument = require('pdfkit');
const { sendError } = require('../../utils/errorResponse');
const { validateChatOwnership } = require('../../services/history.service');
const messageStore = require('../../services/message.store');
const roomManager = require('../../websocket/state/roomManager');
const { parseDirectChatId, toRoomId } = require('../../utils/chatId');
const userLookup = require('../../users/user.service');

function safeFilename(chatId) {
  return String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function toExportMessage(msg) {
  return {
    messageId: msg.messageId || msg.id,
    senderId: msg.senderId,
    content: msg.content,
    createdAt: msg.createdAt ?? msg.timestamp,
    type: msg.messageType || msg.type || 'text',
    state: msg.state,
    roomId: msg.roomId,
    roomMessageId: msg.roomMessageId,
  };
}

async function getParticipantsOrMembers(chatId) {
  if (!chatId || typeof chatId !== 'string') return [];
  const t = chatId.trim();
  if (t.startsWith('direct:')) {
    const participants = parseDirectChatId(t);
    return participants || [];
  }
  const roomId = toRoomId(t);
  if (roomId) {
    try {
      return roomManager.getRoomMembers(roomId) || [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

async function exportChatJson(req, res) {
  // TEMP Phase 1 debug: remove in Phase 2
  console.log('[export] hit exportChatJson', { chatId: req.params.chatId, userId: req.user?.userId });
  const userId = req.user?.userId;
  if (!userId) return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');

  let chatId = req.params.chatId;
  if (!chatId) return sendError(res, 400, 'chatId required', 'INVALID_CHAT_ID');
  try {
    chatId = decodeURIComponent(chatId);
  } catch (_) {
    return sendError(res, 400, 'Invalid chatId', 'INVALID_CHAT_ID');
  }

  if (!validateChatOwnership(chatId, userId)) {
    return sendError(res, 403, "You don't have access to export this chat", 'CHAT_ACCESS_DENIED');
  }

  try {
    const messages = await messageStore.getAllHistory(chatId);
    const participantsOrMembers = await getParticipantsOrMembers(chatId);
    const chatType = chatId.startsWith('direct:') ? 'direct' : 'room';
    const payload = {
      ok: true,
      data: {
        chatId,
        exportedAt: new Date().toISOString(),
        chatType,
        participantsOrMembers,
        totalMessages: messages.length,
        messages: messages.map(toExportMessage),
      },
    };
    const filename = `chat_${safeFilename(chatId)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('Export JSON error:', err);
    sendError(res, 500, 'Failed to export chat', 'EXPORT_ERROR');
  }
}

async function exportChatPdf(req, res) {
  // TEMP Phase 1 debug: remove in Phase 2
  console.log('[export] hit exportChatPdf', { chatId: req.params.chatId, userId: req.user?.userId });
  const userId = req.user?.userId;
  if (!userId) return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');

  let chatId = req.params.chatId;
  if (!chatId) return sendError(res, 400, 'chatId required', 'INVALID_CHAT_ID');
  try {
    chatId = decodeURIComponent(chatId);
  } catch (_) {
    return sendError(res, 400, 'Invalid chatId', 'INVALID_CHAT_ID');
  }

  if (!validateChatOwnership(chatId, userId)) {
    return sendError(res, 403, "You don't have access to export this chat", 'CHAT_ACCESS_DENIED');
  }

  try {
    const messages = await messageStore.getAllHistory(chatId);
    const chatType = chatId.startsWith('direct:') ? 'direct' : 'room';
    const exportedAt = new Date().toISOString();

    const doc = new PDFDocument({ margin: 50 });
    const filename = `chat_${safeFilename(chatId)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    doc.fontSize(18).text('Chat Export', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#666').text(`Chat: ${chatId}`, { align: 'center' });
    doc.text(`Exported: ${exportedAt}`, { align: 'center' });
    doc.text(`Type: ${chatType} | Messages: ${messages.length}`, { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#000');
    for (const msg of messages) {
      const ts = msg.createdAt ?? msg.timestamp;
      const dateStr = ts != null ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '--';
      let senderLabel = msg.senderId;
      try {
        const u = userLookup.getUserById(msg.senderId);
        if (u && (u.displayName || u.username)) senderLabel = u.displayName || u.username;
      } catch (_) {}
      const content = (msg.content || '').toString().replace(/\r?\n/g, ' ');
      doc.fontSize(9).fillColor('#333').text(`[${dateStr}] ${senderLabel}:`, { continued: true });
      doc.fillColor('#000').text(` ${content}`, { lineGap: 2 });
      doc.moveDown(0.3);
    }

    doc.end();
  } catch (err) {
    console.error('Export PDF error:', err);
    if (!res.headersSent) sendError(res, 500, 'Failed to export PDF', 'EXPORT_ERROR');
  }
}

module.exports = {
  exportChatJson,
  exportChatPdf,
};
