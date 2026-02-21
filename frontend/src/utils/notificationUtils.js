/**
 * Notification helpers for desktop notifications.
 * Single source of truth; used across app.
 * All permission requests MUST go through requestNotificationPermission() (PreferencesPage, SettingsModal, etc.).
 * Desktop notifications require a secure context (HTTPS or localhost).
 */

/**
 * @typedef {Object} NotificationCapability
 * @property {boolean} supported
 * @property {boolean} secureContext
 * @property {"granted"|"denied"|"default"|"unsupported"} permission
 * @property {string|null} reason
 */

/**
 * Returns current notification capability and a human-readable reason when not usable.
 * @returns {NotificationCapability}
 */
export function getNotificationCapability() {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const secureContext =
    typeof window !== "undefined" &&
    (window.isSecureContext === true ||
      (typeof location !== "undefined" && location.hostname === "localhost"));

  if (!supported) {
    return {
      supported: false,
      secureContext: !!secureContext,
      permission: "unsupported",
      reason: "Browser does not support desktop notifications.",
    };
  }
  if (!secureContext) {
    return {
      supported: true,
      secureContext: false,
      permission: Notification.permission,
      reason: "Desktop notifications require HTTPS (or localhost).",
    };
  }
  if (Notification.permission === "denied") {
    return {
      supported: true,
      secureContext: true,
      permission: "denied",
      reason: "Notifications are blocked for this site in browser settings.",
    };
  }
  return {
    supported: true,
    secureContext: true,
    permission: Notification.permission,
    reason: null,
  };
}

/**
 * Request or return current notification permission. Only place that calls Notification.requestPermission().
 * Returns "denied" when unsupported, not secure context, or user/browser denied.
 * @returns {Promise<"granted"|"denied"|"default">} Permission string; "denied" when unsupported or not secure.
 */
export async function requestNotificationPermission() {
  const cap = getNotificationCapability();
  if (!cap.supported || !cap.secureContext) {
    return "denied";
  }
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

/**
 * True only when we can show a notification (supported, secure context, permission granted).
 * @returns {boolean}
 */
export function canNotify() {
  const cap = getNotificationCapability();
  return cap.supported && cap.secureContext && cap.permission === "granted";
}

const AUTO_CLOSE_MS = 8000;

/**
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {string} [opts.tag]
 * @param {Record<string, unknown>} [opts.data]
 * @param {() => void} [opts.onClick]
 * @returns {boolean} true if notification was shown, false if not (cannot notify or threw after retry)
 */
export function showDesktopNotification({ title, body, tag, data, onClick }) {
  if (!canNotify()) return false;
  const safeTitle = (title && String(title).trim()) || "New message";
  try {
    const opts = { body: body ?? "", tag, data };
    const n = new Notification(safeTitle, opts);
    if (typeof onClick === "function") {
      n.onclick = () => {
        try {
          window.focus();
        } catch (_) {}
        onClick();
        n.close();
      };
    }
    setTimeout(() => {
      try {
        n.close();
      } catch (_) {}
    }, AUTO_CLOSE_MS);
    return true;
  } catch (err) {
    try {
      const minimalOpts = body ? { body } : undefined;
      const n = new Notification(safeTitle, minimalOpts);
      setTimeout(() => {
        try {
          n.close();
        } catch (_) {}
      }, AUTO_CLOSE_MS);
      return true;
    } catch (retryErr) {
      if (import.meta.env.DEV) {
        console.warn("[NOTIFICATION_ERROR] Failed to show desktop notification", {
          title: safeTitle,
          error: retryErr?.message ?? retryErr,
        });
      }
      return false;
    }
  }
}

/**
 * Legacy helper: show a simple notification by title and body.
 * @param {string} title
 * @param {string} [body]
 * @returns {boolean}
 */
export function showNotification(title, body) {
  return showDesktopNotification({ title, body });
}

/**
 * Test helper: checks capability, requests permission if needed, shows one test notification.
 * Call from a user gesture (e.g. "Test Notification" button). Never uses new Notification() in UI.
 * @param {{ toast: (opts: { title: string; description?: string; variant?: string }) => void }} opts
 * @returns {Promise<boolean>} true if test notification was shown, false otherwise (toast already shown)
 */
export async function testDesktopNotification({ toast }) {
  const cap = getNotificationCapability();
  if (!cap.supported || !cap.secureContext) {
    toast({ title: cap.reason ?? "Desktop notifications are not available.", variant: "destructive" });
    return false;
  }
  if (cap.permission === "default") {
    const permission = await requestNotificationPermission();
    if (permission !== "granted") {
      toast({
        title: "Notifications blocked. Enable in browser settings.",
        variant: "destructive",
      });
      return false;
    }
  }
  if (cap.permission === "denied" || (cap.supported && Notification.permission === "denied")) {
    toast({
      title: "Notifications blocked. Enable in browser settings.",
      variant: "destructive",
    });
    return false;
  }
  const shown = showDesktopNotification({
    title: "Test",
    body: "Desktop notifications are working.",
  });
  return shown;
}
