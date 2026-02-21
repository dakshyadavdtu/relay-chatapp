/**
 * FIX B WARNING
 * This file provides mock chat data used only during early UI development.
 * Fix B removes runtime usage of this file.
 * DO NOT import this file from runtime chat UI after Fix B.
 */

const base = [
  { id: 1, name: "Design Team", thumbnailUrl: null, createdBy: "mock-user-1", createdAt: new Date().toISOString(), members: [{ userId: "mock-user-1", role: "admin", user: { id: "mock-user-1", displayName: "Alex Rivera" } }] },
  { id: 2, name: "Engineering", thumbnailUrl: null, createdBy: "mock-user-1", createdAt: new Date().toISOString(), members: [{ userId: "mock-user-1", role: "admin", user: { id: "mock-user-1", displayName: "Alex Rivera" } }] },
  { id: 3, name: "Random", thumbnailUrl: null, createdBy: "mock-user-2", createdAt: new Date().toISOString(), members: [{ userId: "mock-user-2", role: "admin", user: { id: "mock-user-2", displayName: "Sam Kim" } }] },
];

export const mockGroups = base;

export function getMockGroupById(groupId) {
  return mockGroups.find((g) => g.id === groupId);
}
