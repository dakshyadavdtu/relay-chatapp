/**
 * DEPRECATED: Do not use. Bypasses /api base.
 * Use features/chat/api/chat.api.js with apiFetch.
 */
const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;
if (isDev) throw new Error("Legacy http/chat.api.js disabled; use features/chat/api/chat.api.js");

import { client } from './client.js';

export const chatApi = {
  list: () => client.request('/chat'),
};
