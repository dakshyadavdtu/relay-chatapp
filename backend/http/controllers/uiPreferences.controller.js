'use strict';

/**
 * UI Preferences controller.
 * GET /api/me/ui-preferences - Get current user's UI preferences
 * PATCH /api/me/ui-preferences - Update current user's UI preferences
 */

const userStoreStorage = require('../../storage/user.store');
const { sendError, sendSuccess } = require('../../utils/errorResponse');

/**
 * GET /api/me/ui-preferences
 * Returns current user's UI preferences.
 */
async function getMyUiPreferences(req, res) {
  if (!req.user || !req.user.userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  try {
    const uiPreferences = await userStoreStorage.getUiPreferences(req.user.userId);
    sendSuccess(res, { uiPreferences });
  } catch (err) {
    return sendError(res, 500, 'Failed to load preferences', 'PREFERENCES_ERROR');
  }
}

/**
 * PATCH /api/me/ui-preferences
 * Updates current user's UI preferences.
 * Body: { soundNotifications?: boolean, desktopNotifications?: boolean }
 */
async function patchMyUiPreferences(req, res) {
  if (!req.user || !req.user.userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  const body = req.body || {};
  const patch = {};

  if (body.hasOwnProperty('soundNotifications')) {
    if (typeof body.soundNotifications !== 'boolean') {
      return sendError(res, 400, 'soundNotifications must be a boolean', 'INVALID_PREFERENCE');
    }
    patch.soundNotifications = body.soundNotifications;
  }

  if (body.hasOwnProperty('desktopNotifications')) {
    if (typeof body.desktopNotifications !== 'boolean') {
      return sendError(res, 400, 'desktopNotifications must be a boolean', 'INVALID_PREFERENCE');
    }
    patch.desktopNotifications = body.desktopNotifications;
  }

  if (Object.keys(patch).length === 0) {
    // No changes, return current preferences
    try {
      const uiPreferences = await userStoreStorage.getUiPreferences(req.user.userId);
      return sendSuccess(res, { uiPreferences });
    } catch (err) {
      return sendError(res, 500, 'Failed to load preferences', 'PREFERENCES_ERROR');
    }
  }

  try {
    const updated = await userStoreStorage.patchUiPreferences(req.user.userId, patch);
    if (!updated) {
      return sendError(res, 404, 'User not found', 'USER_NOT_FOUND');
    }
    const uiPreferences = await userStoreStorage.getUiPreferences(req.user.userId);
    sendSuccess(res, { uiPreferences });
  } catch (err) {
    return sendError(res, 500, 'Failed to update preferences', 'PREFERENCES_ERROR');
  }
}

module.exports = {
  getMyUiPreferences,
  patchMyUiPreferences,
};
