'use strict';

/**
 * Capability derivation model.
 * Capabilities are DERIVED server-side from role, never stored or trusted from client.
 */

const { ROLES } = require('./roles');

/**
 * Derive capabilities from role
 * Missing or invalid role results in non-admin capability set (FAIL CLOSED)
 * @param {string} role - User role
 * @returns {Object} Capability object
 */
function capabilitiesFor(role) {
  if (role === ROLES.ADMIN) {
    return {
      devtools: true,
      recovery: true,
      metrics: true
    };
  }

  return {
    devtools: false
  };
}

module.exports = {
  capabilitiesFor
};
