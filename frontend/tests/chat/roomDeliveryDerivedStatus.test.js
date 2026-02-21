/**
 * Room delivery derived status: double tick only when deliveredCount === totalCount (all other members received).
 */

import { describe, it, expect } from "vitest";

/**
 * Same derivation as ChatWindow/RoomMessageList: for my room message, use roomDeliveryByRoomMessageId.
 */
function getRoomMessageDisplayStatus(msg, roomDeliveryByRoomMessageId, isMe) {
  if (!isMe || !msg) return msg?.status ?? "sent";
  const roomMsgId = msg.roomMessageId ?? msg.id;
  const delivery = roomDeliveryByRoomMessageId?.[String(roomMsgId)];
  if (delivery && delivery.totalCount > 0 && delivery.deliveredCount === delivery.totalCount) {
    return "delivered";
  }
  return msg.status ?? "sent";
}

describe("room delivery derived status", () => {
  it("shows delivered when deliveredCount === totalCount and totalCount > 0", () => {
    const msg = { id: "rm_1", roomMessageId: "rm_1", senderId: "me", status: "sent" };
    const map = { rm_1: { deliveredCount: 2, totalCount: 2 } };
    expect(getRoomMessageDisplayStatus(msg, map, true)).toBe("delivered");
  });

  it("shows sent when deliveredCount < totalCount", () => {
    const msg = { id: "rm_1", roomMessageId: "rm_1", senderId: "me", status: "sent" };
    const map = { rm_1: { deliveredCount: 1, totalCount: 2 } };
    expect(getRoomMessageDisplayStatus(msg, map, true)).toBe("sent");
  });

  it("shows sent when no entry for roomMessageId", () => {
    const msg = { id: "rm_1", roomMessageId: "rm_1", senderId: "me", status: "sent" };
    expect(getRoomMessageDisplayStatus(msg, {}, true)).toBe("sent");
    expect(getRoomMessageDisplayStatus(msg, null, true)).toBe("sent");
  });

  it("ROOM_DELIVERY_UPDATE updates map and derived status shows delivered", () => {
    const map = {};
    const roomMessageId = "rm_123";
    const payload = { deliveredCount: 2, totalCount: 2 };
    map[roomMessageId] = payload;
    const msg = { id: roomMessageId, roomMessageId, senderId: "me", status: "sent" };
    expect(getRoomMessageDisplayStatus(msg, map, true)).toBe("delivered");
  });

  it("sender excluded: totalCount 0 never shows delivered", () => {
    const msg = { id: "rm_1", roomMessageId: "rm_1", senderId: "me", status: "sent" };
    const map = { rm_1: { deliveredCount: 0, totalCount: 0 } };
    expect(getRoomMessageDisplayStatus(msg, map, true)).toBe("sent");
  });
});
