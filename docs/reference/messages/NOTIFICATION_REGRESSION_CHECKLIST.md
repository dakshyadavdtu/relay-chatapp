# Desktop notification regression verification checklist

Use this checklist after changes to UI preferences, desktop notifications, or server hydration to confirm behavior.

---

## 1) Toggle ON, accept permission, refresh immediately => stays ON

**Steps:**

1. Log in and open **Settings → Preferences** (or the in-chat settings modal).
2. Turn **Desktop Notifications** **ON**.
3. When the browser prompts, accept (Allow).
4. **Immediately** refresh the page (F5 or Cmd+R).

**Expected:**

- After load, the Desktop Notifications toggle is still **ON**.
- Local state and server hydration both respect the recent local change (fix #1 / #2).

---

## 2) Toggle ON, refresh within 1s => server still true

**Steps:**

1. Turn **Desktop Notifications** **ON** and accept permission.
2. Within **1 second**, refresh the page.
3. After load, open DevTools → Network (or use a REST client).
4. Call **GET** `/api/me/ui-preferences` (same origin, with auth cookies).

**Expected:**

- Response includes `desktopNotifications: true` (unload flush or debounced PATCH has persisted the value).

**Optional:** Use `window.__debugUiPrefs()` in the console before refreshing to see `pendingServerPatch: true` when a sync is still debounced.

---

## 3) Deny permission => toggle forced OFF + toast (modal and preferences)

**Steps (Preferences page):**

1. Open **Settings → Preferences**.
2. Turn **Desktop Notifications** **ON**.
3. In the browser permission prompt, choose **Block** (or dismiss so it stays "denied").
4. Check: toggle is **OFF** and a **toast** appears:  
   **"Notifications blocked"** / **"Enable notifications in your browser settings for this site."** (destructive variant).

**Steps (Settings modal from chat):**

1. From chat, open the settings modal (gear/cog).
2. Turn **Desktop Notifications** **ON**.
3. **Block** (or dismiss) the permission prompt.
4. Check: toggle is **OFF** and the **same toast** appears.

**Expected:**

- In both entry points, toggle ends OFF and the same toast copy is shown (fix #4).

---

## 4) Tab focused => no desktop notifications

**Steps:**

1. Turn **Desktop Notifications** **ON** and ensure permission is granted.
2. Keep the **app tab focused** (and visible).
3. From another device or tab (different user), send a DM to the test user (or use a second account in another window).

**Expected:**

- **No** desktop notification (OS/browser notification) appears while the tab is focused (fix #5: `document.visibilityState === "hidden"` check).

---

## 5) Tab hidden => desktop notifications for new DM

**Steps:**

1. Turn **Desktop Notifications** **ON** and permission granted.
2. **Switch to another tab or minimize the window** so the app tab is **hidden** (`document.visibilityState === "hidden"`).
3. From another device/tab, send a **new DM** to the test user.

**Expected:**

- A **desktop notification** appears for the new message (title/body from message, tag/onClick to open chat).

---

## Optional: Dev console helper

In **development** only, the app exposes:

```js
window.__debugUiPrefs()
```

Call it in the browser console. It prints:

- **prefs** – current UI preferences (e.g. `soundNotifications`, `desktopNotifications`).
- **lastLocalChangeAt** – timestamps when the user last changed sound/desktop prefs (for safe-apply).
- **pendingServerPatch** – whether a debounced server sync is scheduled (timer not yet fired).

Only registered when not running in production (`import.meta.env.PROD === false`).
