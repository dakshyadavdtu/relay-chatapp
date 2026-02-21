'use strict';

/**
 * Auth session store — Atlas-backed. No file persistence.
 * Thin wrapper over sessionStore.mongo.js.
 * Contract: docs/admin/PHASE2_SESSION_CONTRACT.md
 */

module.exports = require('./sessionStore.mongo');
