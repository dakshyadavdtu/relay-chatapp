/**
 * API route definitions. Adapted from mychat shared/routes.
 */

export const api = {
  auth: {
    me: {
      method: "GET",
      path: "/api/me",
    },
  },
  messages: {
    list: {
      method: "GET",
      path: "/api/messages",
    },
    create: {
      method: "POST",
      path: "/api/messages",
    },
  },
};

export function buildUrl(path, params) {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
