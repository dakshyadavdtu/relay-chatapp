// UNUSED AFTER FIX B (mock message helper removed; MOCK_GROUPS still imported by state/chat.state.js)

/**
 * FIX B WARNING
 * This file provides mock chat data used only during early UI development.
 * Fix B removes runtime usage of this file.
 * DO NOT import this file from runtime chat UI after Fix B.
 */

/**
 * Mock chat data for Phase 7 - no backend/websocket.
 */
export const MOCK_GROUPS = [
  { id: 1, name: "General", thumbnailUrl: null, members: [] },
  { id: 2, name: "Team Alpha", thumbnailUrl: null, members: [] },
];
