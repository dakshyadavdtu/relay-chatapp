'use strict';

/**
 * Aggregate delivery tracking per room message (roomMessageId).
 * totalCount = room members excluding sender; deliveredSet = memberIds who have received.
 * When deliveredSet.size === totalCount, sender can be notified (ROOM_DELIVERY_UPDATE).
 */

const store = new Map();

/**
 * Initialize or get state for a room message.
 * @param {string} roomMessageId
 * @param {string} roomId
 * @param {string} senderId
 * @param {number} totalCount - Number of recipients (members excluding sender)
 */
function initOrGet(roomMessageId, roomId, senderId, totalCount) {
  const key = roomMessageId;
  let entry = store.get(key);
  if (!entry) {
    entry = { roomId, senderId, totalCount: Math.max(0, totalCount), deliveredSet: new Set() };
    store.set(key, entry);
  }
  if (totalCount != null && totalCount >= 0 && entry.totalCount === 0) {
    entry.totalCount = totalCount;
  }
  return entry;
}

/**
 * Record that a member has received this room message. Idempotent.
 * @param {string} roomMessageId
 * @param {string} roomId
 * @param {string} senderId
 * @param {string} memberId - Member who received (must not be sender for count)
 * @param {number} [totalCount] - If provided and entry is new, set totalCount
 * @returns {{ complete: boolean, deliveredCount: number, totalCount: number }}
 */
function recordDelivery(roomMessageId, roomId, senderId, memberId, totalCount) {
  const entry = initOrGet(roomMessageId, roomId, senderId, totalCount ?? 0);
  if (memberId && memberId !== senderId) {
    entry.deliveredSet.add(memberId);
  }
  const deliveredCount = entry.deliveredSet.size;
  const total = entry.totalCount;
  const complete = total > 0 && deliveredCount >= total;
  return { complete, deliveredCount, totalCount: total };
}

/**
 * Set total count for a room message (e.g. when sending; members excluding sender).
 * @param {string} roomMessageId
 * @param {string} roomId
 * @param {string} senderId
 * @param {number} totalCount
 */
function setTotal(roomMessageId, roomId, senderId, totalCount) {
  initOrGet(roomMessageId, roomId, senderId, totalCount);
}

/**
 * Get current entry for a room message (for cache-miss check before recordDelivery).
 * @param {string} roomMessageId
 * @returns {{ roomId, senderId, totalCount, deliveredSet } | null}
 */
function getEntry(roomMessageId) {
  if (!roomMessageId) return null;
  return store.get(roomMessageId) || null;
}

/**
 * Hydrate cache from DB after restart. Repopulates deliveredSet and totalCount.
 * @param {string} roomMessageId
 * @param {string} roomId
 * @param {string} senderId
 * @param {string[]} deliveredMemberIds - Recipient IDs who have received (from DB)
 * @param {number} totalCount - Members excluding sender
 */
function hydrate(roomMessageId, roomId, senderId, deliveredMemberIds, totalCount) {
  const entry = initOrGet(roomMessageId, roomId, senderId, totalCount);
  entry.deliveredSet.clear();
  (deliveredMemberIds || []).forEach((id) => {
    if (id && id !== senderId) entry.deliveredSet.add(id);
  });
  if (totalCount != null && totalCount >= 0) entry.totalCount = totalCount;
}

module.exports = {
  initOrGet,
  recordDelivery,
  setTotal,
  getEntry,
  hydrate,
};
