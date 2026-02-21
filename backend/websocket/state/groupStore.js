'use strict';

/**
 * Tier-1: sole owner of group/room idempotency state.
 * senderId:roomId:clientMessageId -> { roomMessageId, messageIds }
 */

const roomClientMessageIdMap = new Map();

function getRoomIdempotency(key) {
  return roomClientMessageIdMap.get(key) || null;
}

function setRoomIdempotency(key, value) {
  roomClientMessageIdMap.set(key, value);
}

function deleteRoomIdempotency(key) {
  roomClientMessageIdMap.delete(key);
}

module.exports = {
  getRoomIdempotency,
  setRoomIdempotency,
  deleteRoomIdempotency,
};
