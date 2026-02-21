'use strict';

/**
 * Context rehydration for WebSocket reconnects.
 * Rebuilds context from server state - NEVER reuses old context.
 * FAIL CLOSED: Disconnects if rehydration fails.
 */

const { capabilitiesFor } = require('../../../auth/capabilities');
const adminGuard = require('../../../admin/admin.guard');

/**
 * Rehydrate WebSocket context from server state
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} userId - Authenticated user ID (from JWT)
 * @param {string} [userRole] - User role (from JWT or DB lookup)
 * @returns {boolean} True if rehydration successful, false if should disconnect
 */
function rehydrateContext(ws, userId, userRole) {
  try {
    // NEVER reuse old ws.context - always rebuild
    // Clear any existing context
    delete ws.context;
    delete ws.adminSubscribed;

    // FAIL CLOSED: userId must be present
    if (!userId || typeof userId !== 'string') {
      return false;
    }

    // Get role from server state (JWT payload or DB lookup)
    // Role may be undefined, resulting in non-admin capabilities
    const role = userRole || undefined;

    // Recompute capabilities (Phase 1) - role is ONLY input
    const capabilities = capabilitiesFor(role);

    // Rebuild context from server state
    ws.context = {
      userId,
      role: role || undefined,
      capabilities
    };

    // Phase 5: On reconnect, admin handlers are NOT auto-reattached
    // Client must explicitly send ADMIN_SUBSCRIBE again
    // This ensures reconnect runs full Phase 0 → Phase 4 pipeline
    // Do NOT trust client-sent state

    return true;
  } catch {
    // On ANY error during rehydration, fail closed
    return false;
  }
}

module.exports = {
  rehydrateContext,
};
