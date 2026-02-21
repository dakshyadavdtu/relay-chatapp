'use strict';

/**
 * Global search controller: GET /api/search?q=<query>
 * Returns groups (by name), contacts (by username/displayName), and messages (content search).
 * Message search is case-insensitive, partial match, limit 20, only in user-visible chats.
 */

const { sendError, sendSuccess } = require('../../utils/errorResponse');
const { toApiUser } = require('../../utils/apiShape');
const userLookup = require('../../users/user.service');
const messageStore = require('../../services/message.store');
const roomStore = require('../../storage/room.mongo');

function generateDirectChatId(userId1, userId2) {
  const sorted = [String(userId1), String(userId2)].sort();
  return `direct:${sorted[0]}:${sorted[1]}`;
}

/**
 * Get all chatIds the user is allowed to see: direct (from message store) + room:ids (from room membership).
 */
async function getAllowedChatIds(userId) {
  const [recipientMessages, senderMessages, rooms] = await Promise.all([
    messageStore.getMessagesForRecipient(userId),
    messageStore.getMessagesForSender(userId),
    roomStore.listRoomsForUser(userId),
  ]);
  const directChatIds = new Set();
  for (const m of [...recipientMessages, ...senderMessages]) {
    const sid = m.senderId;
    const rid = m.recipientId;
    if (sid && rid) directChatIds.add(generateDirectChatId(sid, rid));
  }
  const roomChatIds = (rooms || []).map((r) => (r.id ? `room:${r.id}` : null)).filter(Boolean);
  return [...directChatIds, ...roomChatIds];
}

/**
 * GET /api/search?q=...
 * Response: { groups: [...], contacts: [...], messages: [...] }
 */
async function getSearch(req, res) {
  const userId = req.user?.userId ?? req.user?.id;
  const { q } = req.query;

  if (!userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  const query = typeof q === 'string' ? q.trim() : '';
  if (!query) {
    return sendSuccess(res, { groups: [], contacts: [], messages: [] });
  }

  try {
    const [userSearchResults, rooms, allowedChatIds] = await Promise.all([
      userLookup.searchUsers(query),
      roomStore.listRoomsForUser(userId),
      getAllowedChatIds(userId),
    ]);

    const contacts = (userSearchResults || []).map((u) => toApiUser(u)).filter(Boolean);
    const contactsFiltered = contacts.filter((c) => c && String(c.id) !== String(userId));

    const groupNameLower = query.toLowerCase();
    const groups = (rooms || [])
      .filter((r) => {
        const name = (r.meta && r.meta.name) ? String(r.meta.name) : '';
        return name.toLowerCase().includes(groupNameLower);
      })
      .map((r) => ({
        id: r.id,
        name: (r.meta && r.meta.name) ? String(r.meta.name) : `Group ${r.id || ''}`,
        thumbnailUrl: (r.meta && r.meta.thumbnailUrl) ? String(r.meta.thumbnailUrl) : null,
      }));

    const includeClientMsgId = typeof req.query.includeClientMsgId === 'string' ? req.query.includeClientMsgId.trim() : null;
    const searchOptions = includeClientMsgId ? { includeClientMsgId } : {};
    const messageResults = allowedChatIds.length > 0
      ? await messageStore.searchMessagesInChats(allowedChatIds, query, 20, searchOptions)
      : [];

    const messages = messageResults.map((m) => ({
      messageId: m.messageId,
      chatId: m.chatId,
      chatType: m.chatType || (m.chatId && m.chatId.startsWith('room:') ? 'room' : 'direct'),
      senderId: m.senderId,
      preview: m.preview,
      createdAt: m.createdAt,
    }));

    return sendSuccess(res, { groups, contacts: contactsFiltered, messages });
  } catch (err) {
    console.error('Search error:', err);
    return sendError(res, 500, 'Search failed', 'SEARCH_ERROR');
  }
}

module.exports = { getSearch };
