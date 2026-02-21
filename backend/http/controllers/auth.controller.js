'use strict';

/**
 * HTTP-owned authentication controller.
 * HTTP is the SOLE owner of authentication lifecycle.
 *
 * Phase 6B: /api/me is the single source of truth for auth state.
 * - Login sets a cookie but does NOT authenticate the frontend by itself.
 * - Frontend MUST call GET /api/me to confirm session and get current user.
 * 
 * This controller:
 * - Creates JWT tokens (ONLY place where tokens are generated)
 * - Sets HTTP-only cookies
 * - Clears cookies on logout
 * - Contains NO routing logic
 * - Contains NO cookie parsing logic (that's middleware's job)
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ARCHITECTURAL BOUNDARIES
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * HTTP OWNS:
 * - Login/logout lifecycle
 * - JWT token creation (ONLY place)
 * - Cookie management
 * 
 * HTTP DOES NOT OWN:
 * - WebSocket authentication (WebSocket verifies tokens, doesn't create them)
 * - Real-time session management (that's WebSocket)
 * 
 * See: http/README.md for full contract.
 */

const config = require('../../config/constants');
const { COOKIE_DOMAIN, COOKIE_SECURE, COOKIE_SAME_SITE, COOKIE_PATH } = require('../../config/cookieConfig');
const { capabilitiesFor } = require('../../auth/capabilities');
const { sendError, sendSuccess } = require('../../utils/errorResponse');
const { toApiUser } = require('../../utils/apiShape');
const { ROLES } = require('../../auth/roles');
const userService = require('../../services/user.service');
const userLookup = require('../../users/user.service');
const sessionStore = require('../../auth/sessionStore');
const userStoreStorage = require('../../storage/user.store');
const tokenService = require('../../auth/tokenService');
const { getCookie } = require('../../utils/cookies');
const { getClientIpFromReq } = require('../../utils/ip');

const JWT_COOKIE_NAME = config.JWT_COOKIE_NAME;
const REFRESH_COOKIE_NAME = config.REFRESH_COOKIE_NAME;

const cookieClearOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  path: COOKIE_PATH,
  maxAge: 0,
};
if (COOKIE_DOMAIN) cookieClearOptions.domain = COOKIE_DOMAIN;

function clearAuthCookies(res) {
  res.clearCookie(JWT_COOKIE_NAME, cookieClearOptions);
  res.clearCookie(REFRESH_COOKIE_NAME, cookieClearOptions);
}

/**
 * Login handler (Phase 2)
 * Validates credentials, creates device session, issues access + refresh tokens, sets both httpOnly cookies.
 * Response: user + capabilities (no tokens in JSON).
 * Multiple active sessions allowed: we do NOT revoke existing sessions on login (multi-tab safe).
 */
async function login(req, res) {
  const { username, password } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return sendError(res, 400, 'username and password required', 'INVALID_CREDENTIALS');
  }
  if (!password || typeof password !== 'string') {
    return sendError(res, 400, 'username and password required', 'INVALID_CREDENTIALS');
  }

  const identifier = username.trim().toLowerCase();
  const user = await userService.validateCredentials(identifier, password);
  if (!user) {
    return sendError(res, 401, 'Invalid username or password', 'INVALID_CREDENTIALS');
  }
  const banned = await userStoreStorage.isBanned(user.id);
  if (banned) {
    return sendError(res, 403, 'Account is suspended', 'ACCOUNT_BANNED');
  }

  const userAgent = req.get('user-agent') || null;
  const ip = getClientIpFromReq(req);

  const { sessionId } = await sessionStore.createSession({
    userId: user.id,
    role: user.role || ROLES.USER,
    userAgent,
    ip,
  });

  const accessToken = tokenService.issueAccess({
    userId: user.id,
    sessionId,
    role: user.role || ROLES.USER,
  });

  const { token: refreshToken, hash: refreshHash } = tokenService.issueRefresh();
  const refreshExpiresAt = Date.now() + config.REFRESH_TOKEN_EXPIRES_IN_SECONDS * 1000;
  await sessionStore.storeRefreshHash(sessionId, refreshHash, refreshExpiresAt);

  const devTokenMode = process.env.DEV_TOKEN_MODE === 'true' && req.get('x-dev-token-mode') === '1';
  if (process.env.NODE_ENV === 'production' && devTokenMode) {
    return sendError(res, 500, 'DEV_TOKEN_MODE is not allowed in production', 'CONFIG_ERROR');
  }
  if (!devTokenMode) {
    const cookieOptions = {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: COOKIE_SAME_SITE,
      path: COOKIE_PATH,
    };
    if (COOKIE_DOMAIN) cookieOptions.domain = COOKIE_DOMAIN;
    res.cookie(JWT_COOKIE_NAME, accessToken, {
      ...cookieOptions,
      maxAge: config.ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000,
    });
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...cookieOptions,
      maxAge: config.REFRESH_TOKEN_EXPIRES_IN_SECONDS * 1000,
    });
  }

  const capabilities = capabilitiesFor(user.role);
  const fullUser = await userLookup.getUserById(user.id);
  const apiUser = toApiUser(fullUser || user);
  if (!apiUser) return sendError(res, 401, 'User not found', 'UNAUTHORIZED');

  if (devTokenMode) {
    return sendSuccess(res, {
      user: apiUser,
      capabilities,
      accessToken,
      refreshToken,
    });
  }
  sendSuccess(res, {
    user: apiUser,
    capabilities,
  });
}

/**
 * Refresh handler (Phase 2E)
 * Validates refresh cookie, ensures session not revoked/expired, rotates refresh (atomic), sets new access + refresh cookies.
 * On invalid refresh: clear both cookies + 401.
 */
async function refresh(req, res) {
  const cookieHeader = req.headers.cookie || '';
  const refreshToken = getCookie(cookieHeader, REFRESH_COOKIE_NAME);

  if (!refreshToken || typeof refreshToken !== 'string') {
    clearAuthCookies(res);
    return sendError(res, 401, 'Refresh token required or invalid', 'UNAUTHORIZED');
  }

  const hash = tokenService.hashRefresh(refreshToken);
  const sessionId = await sessionStore.getSessionIdByRefreshHash(hash);
  if (!sessionId) {
    clearAuthCookies(res);
    return sendError(res, 401, 'Invalid or expired refresh token', 'UNAUTHORIZED');
  }

  const session = await sessionStore.getSession(sessionId);
  if (!session || session.revokedAt) {
    clearAuthCookies(res);
    return sendError(res, 401, 'Session revoked', 'UNAUTHORIZED');
  }
  const sessionBanned = await userStoreStorage.isBanned(session.userId);
  if (sessionBanned) {
    clearAuthCookies(res);
    await sessionStore.revokeSession(sessionId);
    return sendError(res, 403, 'Account is suspended', 'ACCOUNT_BANNED');
  }
  if (session.refreshExpiresAt != null && Date.now() > session.refreshExpiresAt) {
    clearAuthCookies(res);
    return sendError(res, 401, 'Refresh token expired', 'UNAUTHORIZED');
  }

  const { token: newRefreshToken, hash: newRefreshHash } = tokenService.issueRefresh();
  const newExpiresAt = Date.now() + config.REFRESH_TOKEN_EXPIRES_IN_SECONDS * 1000;
  const rotated = await sessionStore.rotateRefreshHash(sessionId, hash, newRefreshHash, newExpiresAt);
  if (!rotated) {
    clearAuthCookies(res);
    return sendError(res, 401, 'Invalid or already used refresh token', 'UNAUTHORIZED');
  }

  const accessToken = tokenService.issueAccess({
    userId: session.userId,
    sessionId,
    role: session.role || ROLES.USER,
  });

  const cookieOptions = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAME_SITE,
    path: COOKIE_PATH,
  };
  if (COOKIE_DOMAIN) cookieOptions.domain = COOKIE_DOMAIN;

  res.cookie(JWT_COOKIE_NAME, accessToken, {
    ...cookieOptions,
    maxAge: config.ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, {
    ...cookieOptions,
    maxAge: config.REFRESH_TOKEN_EXPIRES_IN_SECONDS * 1000,
  });

  return sendSuccess(res, { ok: true });
}

/**
 * Logout handler (Phase 2)
 * Revokes current session if sid present, clears both access and refresh cookies.
 */
async function logout(req, res) {
  if (req.user?.sid) {
    await sessionStore.revokeSession(req.user.sid);
  }

  clearAuthCookies(res);

  sendSuccess(res, { message: 'Logged out successfully' });
}

/**
 * Logout current session only (per-tab in dev-token-mode).
 * Revokes only req.user.sessionId; clears cookies only when not dev-token request.
 */
async function logoutCurrent(req, res) {
  if (!req.user || !req.user.userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }
  if (process.env.NODE_ENV === 'production' && req.get('x-dev-token-mode') === '1') {
    return sendError(res, 500, 'DEV_TOKEN_MODE is not allowed in production', 'CONFIG_ERROR');
  }
  const sessionId = req.user.sid ?? req.user.sessionId;
  if (sessionId) {
    await sessionStore.revokeSession(sessionId);
  }
  const isDevTokenRequest = req.get('x-dev-token-mode') === '1';
  if (!isDevTokenRequest) {
    clearAuthCookies(res);
  }
  sendSuccess(res, { message: 'Logged out successfully' });
}

/**
 * Get current user handler
 * Returns authenticated user info from user store (enriched from JWT userId)
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getMe(req, res) {
  if (!req.user || !req.user.userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  const user = await userLookup.getUserById(req.user.userId);
  if (!user) {
    return sendError(res, 401, 'User not found', 'UNAUTHORIZED');
  }

  const isRootAdmin = !!req.user.isRootAdmin;
  const effectiveRole = req.user.effectiveRole ?? (isRootAdmin ? ROLES.ADMIN : (user.role || ROLES.USER));
  const capabilities = capabilitiesFor(effectiveRole);

  const apiUser = toApiUser({ ...user, role: effectiveRole });
  if (!apiUser) return sendError(res, 401, 'User not found', 'UNAUTHORIZED');
  apiUser.isRootAdmin = isRootAdmin;

  sendSuccess(res, {
    user: apiUser,
    capabilities,
  });
}

/** displayName length limits for PATCH /me */
const DISPLAY_NAME_MIN = 1;
const DISPLAY_NAME_MAX = 40;

/**
 * PATCH /me — Update profile (displayName, avatarUrl only). requireAuth. Reject email.
 */
async function patchMe(req, res) {
  if (!req.user || !req.user.userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  const body = req.body || {};

  if (body.hasOwnProperty('email')) {
    return sendError(res, 400, 'Email cannot be changed.', 'EMAIL_READONLY');
  }

  const patch = {};

  if (body.hasOwnProperty('displayName')) {
    if (typeof body.displayName !== 'string') {
      return sendError(res, 400, 'displayName must be a string', 'INVALID_DISPLAY_NAME');
    }
    const trimmed = body.displayName.trim();
    if (trimmed.length < DISPLAY_NAME_MIN || trimmed.length > DISPLAY_NAME_MAX) {
      return sendError(res, 400, `displayName must be between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX} characters`, 'INVALID_DISPLAY_NAME');
    }
    patch.displayName = trimmed;
  }

  if (body.hasOwnProperty('avatarUrl')) {
    if (body.avatarUrl !== null && body.avatarUrl !== undefined && typeof body.avatarUrl !== 'string') {
      return sendError(res, 400, 'avatarUrl must be a string, null, or empty', 'INVALID_AVATAR_URL');
    }
    const urlVal = body.avatarUrl == null ? '' : String(body.avatarUrl).trim();
    if (!urlVal) {
      patch.avatarUrl = null;
    } else {
      if (urlVal.startsWith('/uploads/')) {
        patch.avatarUrl = urlVal;
      } else {
        try {
          const parsed = new URL(urlVal);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return sendError(res, 400, 'avatarUrl must use http or https', 'INVALID_AVATAR_URL');
          }
          patch.avatarUrl = parsed.toString();
        } catch {
          return sendError(res, 400, 'avatarUrl must be a valid URL or empty', 'INVALID_AVATAR_URL');
        }
      }
    }
  }

  await userLookup.updateUser(req.user.userId, patch);

  const user = await userLookup.getUserById(req.user.userId);
  if (!user) {
    return sendError(res, 401, 'User not found', 'UNAUTHORIZED');
  }

  const isRootAdmin = !!req.user.isRootAdmin;
  const effectiveRole = req.user.effectiveRole ?? (isRootAdmin ? ROLES.ADMIN : (user.role || ROLES.USER));
  const capabilities = capabilitiesFor(effectiveRole);

  const apiUser = toApiUser({ ...user, role: effectiveRole });
  if (!apiUser) return sendError(res, 401, 'User not found', 'UNAUTHORIZED');
  apiUser.isRootAdmin = isRootAdmin;

  const updatedAt = Date.now();
  apiUser.updatedAt = updatedAt;

  const userUpdated = require('../../events/userUpdated');
  userUpdated.emitUserUpdated({
    userId: user.id,
    displayName: user.displayName ?? null,
    avatarUrl: user.avatarUrl ?? null,
    updatedAt,
  });

  sendSuccess(res, {
    user: apiUser,
    capabilities,
  });
}

/**
 * Register handler (Phase 2)
 * Same as login: create session, set access + refresh cookies, return user (no tokens in JSON).
 */
async function register(req, res) {
  const { username, password, email } = req.body;

  let user;
  try {
    user = await userService.register({ username, password, email });
  } catch (err) {
    if (err.code === 'INVALID_USERNAME') {
      return sendError(res, 400, err.message, 'INVALID_USERNAME');
    }
    if (err.code === 'INVALID_PASSWORD') {
      return sendError(res, 400, err.message, 'INVALID_PASSWORD');
    }
    if (err.code === 'DUPLICATE_EMAIL') {
      return sendError(res, 400, err.message, 'DUPLICATE_EMAIL');
    }
    throw err;
  }

  const userAgent = req.get('user-agent') || null;
  const ip = getClientIpFromReq(req);

  const { sessionId } = await sessionStore.createSession({
    userId: user.id,
    role: user.role || ROLES.USER,
    userAgent,
    ip,
  });

  const accessToken = tokenService.issueAccess({
    userId: user.id,
    sessionId,
    role: user.role || ROLES.USER,
  });

  const { token: refreshToken, hash: refreshHash } = tokenService.issueRefresh();
  const refreshExpiresAt = Date.now() + config.REFRESH_TOKEN_EXPIRES_IN_SECONDS * 1000;
  await sessionStore.storeRefreshHash(sessionId, refreshHash, refreshExpiresAt);

  const cookieOptions = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAME_SITE,
    path: COOKIE_PATH,
  };
  if (COOKIE_DOMAIN) cookieOptions.domain = COOKIE_DOMAIN;

  res.cookie(JWT_COOKIE_NAME, accessToken, {
    ...cookieOptions,
    maxAge: config.ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...cookieOptions,
    maxAge: config.REFRESH_TOKEN_EXPIRES_IN_SECONDS * 1000,
  });

  const capabilities = capabilitiesFor(user.role);
  const fullUser = await userLookup.getUserById(user.id);
  const apiUser = toApiUser(fullUser || user);
  if (!apiUser) return sendError(res, 500, 'User not found after register', 'INTERNAL_ERROR');

  sendSuccess(res, {
    user: apiUser,
    capabilities,
  }, 201);
}

/**
 * PATCH /me/password — Change password (requires current password verification).
 * Body: { currentPassword, newPassword }
 * Validates current password, then updates to new password hash.
 */
async function changePassword(req, res) {
  if (!req.user || !req.user.userId) {
    return sendError(res, 401, 'Not authenticated', 'UNAUTHORIZED');
  }

  const { currentPassword, newPassword } = req.body || {};

  // Validate input
  if (!currentPassword || typeof currentPassword !== 'string') {
    return sendError(res, 400, 'currentPassword is required', 'INVALID_REQUEST');
  }
  if (!newPassword || typeof newPassword !== 'string') {
    return sendError(res, 400, 'newPassword is required', 'INVALID_REQUEST');
  }

  // Validate new password length (match UI requirement: >= 8)
  if (newPassword.length < 8) {
    return sendError(res, 400, 'New password must be at least 8 characters', 'INVALID_PASSWORD');
  }

  const userId = req.user.userId;

  // Get user to verify current password
  const user = await userStoreStorage.findById(userId);
  if (!user) {
    return sendError(res, 401, 'User not found', 'UNAUTHORIZED');
  }

  // Verify current password matches
  const passwordMatches = await userService.comparePassword(currentPassword, user.passwordHash);
  if (!passwordMatches) {
    return sendError(res, 400, 'Current password is incorrect', 'INVALID_PASSWORD');
  }

  // Update password hash
  const updated = await userService.updatePassword(userId, newPassword);
  if (!updated) {
    return sendError(res, 400, 'Password does not meet requirements', 'INVALID_PASSWORD');
  }

  sendSuccess(res, { success: true });
}

module.exports = {
  login,
  refresh,
  logout,
  logoutCurrent,
  getMe,
  patchMe,
  register,
  changePassword,
};
