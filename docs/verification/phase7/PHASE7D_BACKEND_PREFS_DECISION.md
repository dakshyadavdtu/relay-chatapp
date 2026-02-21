# Phase 7D — Backend wiring decision: user preferences

## Backend supports prefs? **No**

---

## 1. Scan results

Scanned the backend for preferences/settings/user-config endpoints:

**Locations searched**

- `backend/http/routes/*` — auth, user, chat, history, sessions, admin
- `backend/http/controllers/*` — auth.controller, user.controller, chat.controller, history.controller, sessions.controller, admin.controller
- Grep for: `preferences`, `settings`, `profile`, `theme`, `ui`, `config`, `prefs`

**Existing HTTP routes (relevant)**

| Method | Path            | Purpose                    | Preferences? |
|--------|-----------------|----------------------------|-------------|
| GET    | /api/me         | Current user + capabilities| No (user, capabilities only) |
| GET    | /users/me       | Current user (identity)    | No          |
| POST   | /api/login      | Login; returns user + capabilities | No  |
| POST   | /api/register   | Register; returns user + capabilities | No |
| GET    | /users/search   | User search                | No          |
| GET    | /users/:id      | User by ID                 | No          |

**Auth/me response shape (current)**

- `GET /api/me`: `{ success: true, data: { user: { id, username, role, ... }, capabilities } }`
- No `preferences`, `settings`, `theme`, `textSize`, `density`, or other UI prefs in the response.

**Conclusion**

- There are **no** endpoints for:
  - GET/PATCH user preferences or settings
  - Theme, text size, density, reduced motion, or other UI prefs
- No `preferences.routes`, `settings.routes`, or similar. No controller methods that read/write user UI preferences.

---

## 2. Decision: client-only persistence

- **Backend does NOT support user preferences/settings.**
- **Implementation:** Keep client-only persistence (localStorage) via the existing ui_prefs layer. No backend calls for prefs.
- **Backend ticket needed** when/if the product requires server-stored preferences (e.g. sync across devices, account-level defaults). Suggested contract when adding backend support:
  - `GET /api/me` (or `GET /api/preferences`) — include optional `preferences` object aligned with `uiPreferences.contract.json`.
  - `PATCH /api/preferences` (or `PATCH /api/me` with `preferences`) — accept partial prefs, return updated prefs.

---

## 3. No backend changes in this phase

- No new backend routes or controllers were added.
- No invented endpoints. Frontend continues to use **localStorage only** (key: `chat-settings`) and **ui_prefs** (hydrate/apply/persist) as implemented in Phase 7A/7B/7C.

---

## 4. If backend adds support later

1. Add `settings.api.js` (or extend existing api module) with:
   - `fetchPreferences()` — GET preferences (e.g. after /api/me or dedicated GET).
   - `patchPreferences(partial)` — PATCH with debounce.
2. On login and on successful `/api/me`: if the response includes `preferences`, hydrate ui_prefs from server (merge with contract defaults), then apply.
3. On pref change in the UI: continue to call `setUiPref`; optionally sync to backend (e.g. debounced PATCH) when the backend contract is available.
