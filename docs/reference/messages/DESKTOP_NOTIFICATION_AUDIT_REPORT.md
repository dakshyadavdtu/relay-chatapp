# Desktop Notification Flow — Audit Report

**Scope:** React + WebSocket chat app — Settings → Preferences → Desktop Notifications toggle.  
**Report type:** Diagnosis only (no fixes).  
**Date:** 2025-02-20.

---

## 1. Full notification flow (trace)

### 1.1 Where toggle state is stored

| Layer | Location | Notes |
|-------|----------|--------|
| **In-memory** | `myfrontend/frontend/src/features/ui_prefs/store/uiPrefs.store.js` | Single module-level `state` object; `desktopNotifications` is a boolean (default `false`). |
| **Read API** | `getUiPrefs()` in same file | Returns shallow copy of `state`. Used by ChatAdapterContext at notification time and by hooks. |
| **Write API** | `setUiPref("desktopNotifications", value)` | Validates via contract, updates state, persists, applies DOM, notifies subscribers, schedules server sync. |

**No Redux/Zustand for this pref.** The app uses a custom subscribable store in `uiPrefs.store.js`. Both `useSettings()` and `useSettingsStore()` delegate to `useUiPrefs()` (same store).

- `src/hooks/useSettings.js` → `useUiPrefs()`
- `src/features/chat/adapters/useSettingsAdapter.js` → `useUiPrefs()`

**Legacy (not in active path):** `src/state/settings.state.js` and `src/state/slices/settings.slice.js` also define `desktopNotifications` and use the same localStorage key `chat-settings`. They are not used by the current settings UI or by the chat adapter for notifications. `ChatAdapterContext.jsx` imports `getSettingsState` but does not use it in the notification path.

---

### 1.2 Where it is persisted

| Where | How |
|-------|-----|
| **Client** | `localStorage` key `chat-settings` (from `uiPreferences.contract.json` → `contract.persistence?.client?.key`). Written in `uiPrefs.persist.js` via `persist(state)` from `setUiPref`. Hydrated in `uiPrefs.hydrate.js` and loaded in `bootstrap()` at app init. |
| **Server** | PATCH ` /api/me/ui-preferences` with `{ desktopNotifications: boolean }`. Called from `uiPrefs.store.js` via `scheduleSyncToServer()` → `flushSyncToServer()` → `updateServerUiPrefs(patch)` in `uiPrefs.server.js`. Debounce 300 ms; fire-and-forget with retries. |

**Backend:**  
- GET/PATCH in `backend/http/controllers/uiPreferences.controller.js`; storage in `backend/storage/user.mongo.js` (`uiPreferences.desktopNotifications`).

---

### 1.3 Where `Notification.requestPermission()` is called

| File | When |
|------|------|
| `myfrontend/frontend/src/utils/notificationUtils.js` | `requestNotificationPermission()` — only returns existing permission if already `"granted"` or `"denied"`; otherwise calls `Notification.requestPermission()`. Not called automatically on app load. |
| `myfrontend/frontend/src/features/settings_ui/PreferencesPage.jsx` | Inside `handleDesktopNotificationsChange(checked)` when user turns the toggle **ON** (`checked === true`). Awaits `requestNotificationPermission()` then sets pref from result. **Tied to user gesture (toggle).** |
| `myfrontend/frontend/src/components/settings/SettingsModal.jsx` | Inside `handleDesktopNotifications(enabled)` when user turns **ON** and `Notification.permission !== "granted"`: calls `Notification.requestPermission().then(...)`. **Tied to user gesture (toggle).** |
| `SettingsModal.jsx` — `handleTestNotification` | When user clicks "Test Notifications" and `Notification.permission === "default"`: calls `Notification.requestPermission()`. **Tied to user gesture (button).** |

No permission request is made on page load or on first message; permission is only requested when the user interacts with the toggle or test button.

---

### 1.4 Where `new Notification()` is triggered

| File | Function | When |
|------|----------|------|
| `myfrontend/frontend/src/utils/notificationUtils.js` | `showDesktopNotification({ title, body, tag, data, onClick })` | Uses `canNotify()` (requires `Notification.permission === "granted"`); then `new Notification(title, { body, tag, data })`. Auto-closes after 8 s; optional `onClick` focuses window and runs callback. |
| `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` | DM path (~line 514) and ROOM path (~line 1232) | Only after: `!isActive && cooldownOk && prefs.desktopNotifications && text`. Then calls `showDesktopNotification({ title: text.slice(0,120), body: "", tag: chatId, data, onClick })`. So the **caller** checks the toggle; `showDesktopNotification` does **not** check the toggle, only permission. |
| `SettingsModal.jsx` — `handleTestNotification` | Inline | Uses `new Notification("Chat", { body: "Test notification" })` when permission is `"granted"`, or after requesting and getting `"granted"`. Does not use `showDesktopNotification`. |

So the only production path that shows a desktop notification for new messages is: **ChatAdapterContext** → `getUiPrefs()` → check `prefs.desktopNotifications` → `showDesktopNotification()` → `canNotify()` → `new Notification()`.

---

### 1.5 Service worker / Push API

**Not used.** No `serviceWorker`, `pushManager`, or Push API references in the frontend. Notifications are in-page only via the Notification API.

---

## 2. Identified issues (root causes)

### 2.1 Server hydration overwrites recent local desktop toggle (toggle “ignored” after refresh)

**Location:**  
- `myfrontend/frontend/src/components/system/AuthLoadingGate.jsx` (lines 41–43)  
- `myfrontend/frontend/src/features/ui_prefs/store/uiPrefs.store.js` (lines 144–146, 189–222)

**What happens:**  
- For **soundNotifications**, the store sets `lastLocalChangeAt[key] = Date.now()` in `setUiPref` and AuthLoadingGate uses `applyServerPrefIfNotOverridden("soundNotifications", serverValue)` so a recent local change wins over the server.  
- For **desktopNotifications**, the store **does not** set `lastLocalChangeAt["desktopNotifications"]` in `setUiPref` (only `soundNotifications` does). AuthLoadingGate always does `setUiPref("desktopNotifications", serverPrefs.desktopNotifications)` with no `applyServerPrefIfNotOverridden`.

**Result:**  
- User turns desktop notifications ON → local state and localStorage updated → debounced PATCH (300 ms) is scheduled.  
- If the user refreshes (or navigates and AuthLoadingGate runs again) **before** the PATCH completes or after a failed PATCH, the server still has `desktopNotifications: false`.  
- On load: `bootstrap()` restores from localStorage (may have `true`), then AuthLoadingGate overwrites with server (`false`).  
- **Toggle appears to be “ignored” or “reset after refresh”** — desktop notifications stop working until the user turns the toggle on again (and doesn’t refresh before sync completes).

**Exact broken logic:**  
- In `uiPrefs.store.js`, inside `setUiPref`, only `soundNotifications` updates `lastLocalChangeAt`.  
- In `AuthLoadingGate.jsx`, desktop prefs are applied with an unconditional `setUiPref("desktopNotifications", serverPrefs.desktopNotifications)` instead of `applyServerPrefIfNotOverridden("desktopNotifications", ...)`.

---

### 2.2 Toggle state can be overwritten before it is ever synced (race)

**Location:** Same as 2.1.

**What happens:**  
- User enables desktop notifications → `setUiPref("desktopNotifications", true)` → `scheduleSyncToServer()` (300 ms debounce).  
- User refreshes within 300 ms.  
- Sequence: `bootstrap()` loads from localStorage (true) → React tree mounts → AuthLoadingGate runs, fetches GET `/api/me/ui-preferences` (still false) → `setUiPref("desktopNotifications", false)`.  
- So the **server value always wins** on the first load after a quick refresh, and there is no “recent local change” protection for desktop.

**Result:** Notifications “work only after refresh” in the sense that the **first** refresh can **turn them off** if the server wasn’t updated yet; the user may need to toggle again and wait for sync (or not refresh) for them to “work” reliably.

---

### 2.3 Permission “default” blocks notifications until user uses toggle (by design, but can feel broken)

**Location:**  
- `myfrontend/frontend/src/utils/notificationUtils.js` — `canNotify()` returns true only when `Notification.permission === "granted"`.  
- No automatic permission request on app load or on first message.

**What happens:**  
- If the user never opens Settings/Preferences and never turns the desktop toggle ON, permission stays `"default"`.  
- When a message arrives, ChatAdapterContext checks `prefs.desktopNotifications` (false by default) and does not call `showDesktopNotification`. So notifications “do not appear” until the user enables the toggle (which triggers `requestPermission()`).  
- If the user enabled notifications in a previous session and the server/local state is later overwritten (e.g. by 2.1), `prefs.desktopNotifications` can be false even though the user previously granted permission — again, no notifications until they toggle again.

**Result:** Notifications can “not appear” or “appear inconsistently” depending on hydration/override behavior; combined with 2.1/2.2 this reinforces the feeling that the toggle or permission flow is broken.

---

### 2.4 SettingsModal: when permission is not “granted”, UI feedback is weaker than PreferencesPage

**Location:** `myfrontend/frontend/src/components/settings/SettingsModal.jsx` — `handleDesktopNotifications` (lines 55–61).

**What happens:**  
- User turns toggle ON; `Notification.requestPermission()` is called. If the user dismisses the browser prompt or denies, permission stays `"default"` or becomes `"denied"`. The handler sets `setDesktopNotifications(permission === "granted")` (i.e. false).  
- **SettingsModal does not show a toast** when permission is not granted.  
- **PreferencesPage** does: it shows a toast “Notifications blocked – Enable notifications in your browser settings…”.

**Result:** In the modal (e.g. from chat), the toggle can flip back to off with no explanation, so the permission flow can feel “broken” or confusing.

---

### 2.5 No explicit “tab focused” check for desktop notifications (design choice)

**Location:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` — DM block (~480–523), ROOM block (~1198–1241).

**What happens:**  
- Desktop notification is shown when: `!isActive && cooldownOk && prefs.desktopNotifications && text`.  
- `isActive` = (current conversation id === this chat/room). There is **no** check for `document.visibilityState` or `document.hasFocus()` for the desktop path.  
- So if the tab is **focused** but the user is viewing another conversation, a desktop notification is still shown for the non-active one.

**Result:** Notifications can appear “when tab is focused” (banner while the app is visible). This is consistent with “notify when this conversation is not active.” If the product requirement is “no desktop notifications when the app tab is focused,” this would be a missing check.

---

### 2.6 Stale state / closure (not a bug in current code)

**Location:** ChatAdapterContext WS handler (e.g. `mergeMessageReceiveRef.current`).

**What happens:**  
- The handler calls `getUiPrefs()` **at the time the WebSocket event is processed**, not at closure creation. So the pref value used for `prefs.desktopNotifications` is current at event time.  
- No stale closure issue for the toggle in the notification path.

---

### 2.7 Dead import (minor)

**Location:** `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` line 36.

**What happens:** `getSettingsState` is imported from `@/state/settings.state` but not used in the file. Notification logic uses only `getUiPrefs()`. This is legacy/cruft, not a functional bug.

---

## 3. Summary table

| Issue | Root cause | File(s) |
|-------|------------|--------|
| Toggle ignored / reset after refresh | Server hydration always overwrites desktop pref; no `lastLocalChangeAt` for desktop; no `applyServerPrefIfNotOverridden` for desktop | `AuthLoadingGate.jsx`, `uiPrefs.store.js` |
| Notifications work only after refresh (or stop after refresh) | Race: refresh before debounced PATCH completes → server still false → hydration overwrites local true | Same as above |
| Notifications do not appear / inconsistent | Default permission + default pref false; or server overwriting local true (2.1/2.2) | `notificationUtils.js`, `AuthLoadingGate.jsx`, `uiPrefs.store.js` |
| Permission flow feels broken in modal | No toast when permission not granted in SettingsModal | `SettingsModal.jsx` |
| Notifications when tab focused | By design: only “conversation not active” is checked; no visibility check | `ChatAdapterContext.jsx` |
| Permission “default” blocks notifications | By design: no auto-request; `canNotify()` requires `"granted"` | `notificationUtils.js` |

---

## 4. File reference

| Purpose | File path |
|---------|-----------|
| Toggle state (store) | `myfrontend/frontend/src/features/ui_prefs/store/uiPrefs.store.js` |
| Persist (localStorage) | `myfrontend/frontend/src/features/ui_prefs/uiPrefs.persist.js`, `uiPrefs.hydrate.js` |
| Server sync | `myfrontend/frontend/src/features/ui_prefs/uiPrefs.server.js` |
| Request permission | `myfrontend/frontend/src/utils/notificationUtils.js` |
| Show notification | `myfrontend/frontend/src/utils/notificationUtils.js` — `showDesktopNotification`, `canNotify` |
| Trigger on message (DM) | `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` ~477–523 |
| Trigger on message (ROOM) | `myfrontend/frontend/src/features/chat/adapters/ChatAdapterContext.jsx` ~1192–1241 |
| Preferences page toggle | `myfrontend/frontend/src/features/settings_ui/PreferencesPage.jsx` |
| Settings modal toggle | `myfrontend/frontend/src/components/settings/SettingsModal.jsx` |
| Hydration from server | `myfrontend/frontend/src/components/system/AuthLoadingGate.jsx` |
| Bootstrap | `myfrontend/frontend/src/main.jsx` (calls `bootstrap()` from ui_prefs) |
| Contract defaults | `myfrontend/frontend/src/contracts/uiPreferences.contract.json` |

---

## 5. Conclusion

The main functional bugs are:

1. **Server hydration overwrites the desktop notifications toggle** because `desktopNotifications` is not protected by “recent local change” (no `lastLocalChangeAt`, no `applyServerPrefIfNotOverridden` in AuthLoadingGate), so the toggle can appear to be ignored or reset after refresh.  
2. **Debounce race:** Refreshing before the 300 ms PATCH completes leaves the server with the old value, so after load the server response overwrites the user’s local ON state.  
3. **Weaker UX in SettingsModal** when permission is not granted (no toast), making the permission flow feel broken.

Permission request is correctly tied to user interaction. The Notification API is used without a service worker or Push API. Toggle state for the notification decision is read at event time via `getUiPrefs()`, so there is no stale-closure bug in the current code.
