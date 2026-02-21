# PHASE 7A — UI Preferences Analysis Report

## Source Directories

| Source | Path | Notes |
|--------|------|-------|
| myset copy 2 | `myset copy 2/` | Standalone settings UI; Preferences page + use-settings hook |
| mychat original copy 7 | `mychat original copy 7/` | Chat app with embedded Settings modal (dummy panel) |

---

## Source Files Scanned

### myset copy 2
- `src/pages/PreferencesPage.jsx` — Theme, Text Size, Compact Mode, Reduced Motion, Enter to Send, Message Grouping, Sound Effects, Desktop Notifications, Export
- `src/hooks/use-settings.js` — initialSettings, useSettings, useUpdateSettings; theme applied to document.documentElement
- `src/components/SettingsLayout.jsx` — Layout only; no preference bindings

### mychat original copy 7
- `frontend/src/features/settings/SettingsModal.jsx` — APPEARANCE (Theme, Text Size, Density, Reduced Motion), MESSAGES (Enter to Send, Message Grouping), NOTIFICATIONS (Sound, Desktop), POWER (Export)
- `frontend/src/store/settingsStore.js` — Zustand persist; keys: theme, textSize, density, reducedMotion, enterToSend, messageGrouping, soundNotifications, desktopNotifications
- `frontend/src/app/App.jsx` — Applies theme, textSize, density, reducedMotion to `document.documentElement` via classList
- `frontend/src/index.css` — `.text-small`, `.text-medium`, `.text-large`, `.density-compact`, `.density-comfortable`, `.reduced-motion`
- `frontend/src/features/chat/ChatWindow.jsx` — Consumes reducedMotion, enterToSend, messageGrouping from useSettingsStore

---

## Full List of Preferences (Canonical Keys)

| Key | Type | Values | Default | Affects |
|-----|------|--------|---------|---------|
| theme | enum | light, dark, system | light | AppShell, Chat, Settings |
| textSize | enum | small, medium, large | medium | Global |
| density | enum | comfortable, compact | comfortable | Chat (msg-list, bubbles, sidebar, header) |
| reducedMotion | boolean | true, false | false | Global |
| enterToSend | boolean | true, false | true | Chat input |
| messageGrouping | boolean | true, false | true | Chat message list |
| soundNotifications | boolean | true, false | true | Chat (new message sound) |
| desktopNotifications | boolean | true, false | false | Chat (browser Notification) |

---

## Preferences That Must Affect Chat UI

- **density** — msg-list gap, msg-bubble padding, sidebar-item padding, chat-header padding
- **enterToSend** — keyboard behavior (Enter vs Shift+Enter)
- **messageGrouping** — render logic for grouping consecutive messages
- **soundNotifications** — play sound on MESSAGE_RECEIVE
- **desktopNotifications** — show Notification on new message
- **reducedMotion** — disable animations (affects chat transitions)
- **theme** — light/dark affects chat bubbles, sidebar
- **textSize** — affects message text, input, timestamps

---

## Current Persistence

| Source | Mechanism | Storage Key |
|--------|-----------|-------------|
| myset copy 2 | In-memory (settingsState) + listener pattern | None for main prefs |
| myset copy 2 | localStorage (direct) | `msg_enter_to_send`, `msg_grouping` |
| mychat original copy 7 | Zustand persist | `chat-settings` (localStorage) |
| myfrontend (integrated) | Redux + localStorage middleware | `chat-settings` |

---

## Conflicts Between myset copy 2 and mychat original copy 7

| Issue | myset copy 2 | mychat original copy 7 |
|-------|--------------|------------------------|
| Theme values | light, dark, **system** | light, dark only |
| Theme default | system | light |
| Sound key | `soundEnabled` | `soundNotifications` |
| Enter/Group persistence | Separate localStorage keys | Bundled in zustand |
| Main prefs persistence | In-memory only | Zustand persist |
| useUpdateSettings | Applies theme to root on update | App.jsx useEffect applies all prefs |

---

## UI Binding Summary

| Pref | Mechanism | Target |
|------|-----------|--------|
| theme | class (light/dark) | document.documentElement |
| textSize | class (text-small, text-medium, text-large) | document.documentElement |
| density | class (density-comfortable, density-compact) | document.documentElement |
| reducedMotion | class (reduced-motion) | document.documentElement |
| enterToSend | behavior | ChatWindow keyboard handler |
| messageGrouping | behavior | ChatWindow message list render |
| soundNotifications | behavior | MESSAGE_RECEIVE handler |
| desktopNotifications | behavior | MESSAGE_RECEIVE handler |

---

## Backend Support

**None.** No backend endpoint exists for user preferences. All preferences are client-only and persist via localStorage.

---

## Recommendation for Phase 7B+

1. **Standardize keys:** Use `soundNotifications` (not `soundEnabled`).
2. **Add system theme:** mychat should support `theme: "system"` like myset.
3. **Unified storage:** Single localStorage key `chat-settings` with all prefs (as in myfrontend Redux).
4. **Ensure chat components read from same store** as App/Preferences (useSettingsAdapter should delegate to Redux, not return stubs).
