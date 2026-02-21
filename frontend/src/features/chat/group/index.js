/**
 * Group/room feature module.
 * - identity: normalizeRoomId, toRoomChatId, isRoomChatId, roomIdFromChatId
 * - history: getRoomHistory(roomIdRaw, limit, beforeId)
 * - RoomMessageList: group-only message list component (fetch + render from GET /api/chat?chatId=room:<id>)
 */
export { normalizeRoomId, toRoomChatId, isRoomChatId, roomIdFromChatId } from "./identity";
export { getRoomHistory } from "./history";
export { RoomMessageList } from "./RoomMessageList";
