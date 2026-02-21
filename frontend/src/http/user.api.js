/**
 * DEPRECATED: Do not use. Bypasses /api base. Auth uses src/http/auth.api.js with apiFetch.
 */
const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;
if (isDev) throw new Error("Legacy http/user.api.js disabled; use apiFetch from src/lib/http.js");

import { client } from './client.js';

export const userApi = {
  me: () => client.request('/users/me'),
};
