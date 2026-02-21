/**
 * FIX B WARNING
 * This file provides mock chat data used only during early UI development.
 * Fix B removes runtime usage of this file.
 * DO NOT import this file from runtime chat UI after Fix B.
 */

/**
 * Phase 3: Mock chat state for UI transplant. Stub data only; no store/socket wiring.
 * B5.4: Uses inline stubs only (no external user list).
 */

import { mockGroups } from "../mock/mockGroups.js";

const now = Date.now();
const STUB_USER_IDS = ["stub-1", "stub-2"];

export const MOCK_CURRENT_USER = { id: "current-user", username: "me", displayName: "Me" };

export function getMockGroups() {
  return [...mockGroups];
}

export function getMockMessagesByConversation() {
  const byConversation = {};
  mockGroups.forEach((g) => {
    byConversation[`group-${g.id}`] = [
      { id: 1, senderId: STUB_USER_IDS[0], content: "Hey everyone!", status: "read", createdAt: new Date(now - 3600000) },
      { id: 2, senderId: STUB_USER_IDS[1], content: "Hi there!", status: "read", createdAt: new Date(now - 3500000) },
      { id: 3, senderId: "current-user", content: "Hello from me", status: "read", createdAt: new Date(now - 3400000) },
    ];
  });
  STUB_USER_IDS.forEach((id) => {
    byConversation[`dm-${id}`] = [];
  });
  return byConversation;
}

export const MOCK_CONNECTION_STATUS = "connected";

export function getMockPresenceUsers() {
  const users = {};
  STUB_USER_IDS.forEach((id) => {
    users[id] = { online: false, lastSeen: null, typing: false };
  });
  return users;
}
