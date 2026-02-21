# Repeated API / WS Calls — Root Cause Report

## 1. Callsites for each endpoint

### GET /api/chats

| Location | In effect? | Dependency array | Notes |
|---------|------------|------------------|--------|
| **ChatRoot.jsx** | `useEffect` | `[isAuthenticated]` only (run-on-auth guard) | Calls `loadChatsRef.current?.()` once when auth becomes true; `didLoadRef` prevents re-run on identity change. |
| **ChatAdapterContext.jsx** | — | `loadChats` is `useCallback(..., [isAuthenticated, mergeUsersFromSearch])` | Implements `loadChats`; uses `usersByIdRef.current` for hydration; in-flight + reqId guard. |
| **ChatAdapterContext.jsx** | Inside `setApiChats` updater | — | Optimistic update only (no refetch) when adding new DM to list. |

**chat.api.js**  
- `getChats()` (line 8–10): `apiFetch("/api/chats")` — only caller is `loadChats` in ChatAdapterContext.

---

### GET /api/users (directory)

| Location | In effect? | Dependency array | Notes |
|---------|------------|------------------|--------|
| **ChatAdapterContext.jsx** | `useEffect` | `[isAuthenticated, authLoading, authUser?.id]` | Direct `apiFetch("/api/users")` for DM picker; guard `authUser?.id == null` return. |
| **ChatAdapterContext.jsx** (line 1955) | Inside `loadChats` | — | `apiFetch(\`/api/users/${userId}\`)` for **per-user** hydration (not directory). |

**Unstable deps:**  
- `authUser?.displayName`, `authUser?.avatarUrl` can change reference when auth state updates (new object), causing the directory effect to re-run.

---

### GET /api/me/ui-preferences

| Location | In effect? | Dependency array | Notes |
|---------|------------|------------------|--------|
| **AuthLoadingGate.jsx** (line 21–64) | `useEffect` | `[isLoading, isAuthenticated]` | Calls `fetchServerUiPrefs()` once when `!isLoading && isAuthenticated`, guarded by `hydratedRef.current`. |

**uiPrefs.server.js**  
- `fetchServerUiPrefs()` (line 16–29): calls `apiFetch(UI_PREFS_PATH)` where `UI_PREFS_PATH = "/api/me/ui-preferences"`.

**Repeated calls:**  
- If `AuthLoadingGate` remounts (e.g. parent re-mount or key change), `hydratedRef` resets and the effect runs again → another GET ui-preferences.

---

### POST /api/auth/refresh

| Location | In effect? | Dependency array | Notes |
|---------|------------|------------------|--------|
| **lib/http.js** | No effect | — | `doRefresh()` called from (1) `ensureRefreshBeforeRequest()` before “important” paths, (2) 401 retry path, (3) `runWsRefreshLoop()` (timer after HELLO_ACK). |

No React effect directly calls refresh; it’s triggered by `apiFetch` (proactive refresh or 401).

---

### WS connect (ws://…/ws)

| Location | In effect? | Dependency array | Notes |
|---------|------------|------------------|--------|
| **ChatAdapterContext.jsx** (line 648–1526) | `useEffect` | `[isAuthenticated, authLoading]` | Calls `wsClient.connect()` when authenticated and not loading. Cleanup calls `wsClient.disconnect()`. |

**wsClient.js**  
- `connect()` (line 186): creates WebSocket; called from (1) ChatAdapterContext effect above, (2) internal `scheduleReconnect()` / auth-change reconnect.

**Repeated connect:**  
- If the ChatAdapterContext effect re-runs (e.g. `authLoading` or `isAuthenticated` flipping, or provider remount), cleanup runs `disconnect()` and the next run calls `connect()` again → reconnect loop.

---

## 2. Effect vs render; dependency arrays; unstable deps

- **ChatRoot**  
  - `useEffect(() => { if (isAuthenticated) loadChats(); }, [loadChats, isAuthenticated])`.  
  - **Unstable:** `loadChats` is in the dependency array. `loadChats` is recreated whenever `usersById` or `mergeUsersFromSearch` changes (see below) → effect re-runs → repeated `/api/chats`.

- **ChatAdapterContext — loadChats**  
  - `useCallback(..., [isAuthenticated, usersById, mergeUsersFromSearch])`.  
  - **Unstable:** `usersById` is state. When `loadChats` runs it may call `mergeUsersFromSearch(fetchedUsers)` → `setUsersById` / `setUsers` → `usersById` changes → new `loadChats` → consumers (e.g. ChatRoot) see new `loadChats` → effect runs again → **loop**.

- **ChatAdapterContext — GET /api/users effect**  
  - Deps: `[isAuthenticated, authLoading, authUser?.id, authUser?.displayName, authUser?.avatarUrl]`.  
  - **Unstable:** `authUser` can be a new object reference on each auth state update → effect re-runs → repeated GET /api/users.

- **ChatAdapterContext — WS effect**  
  - Deps: `[isAuthenticated, authLoading]`.  
  - Stable if auth is stable. If auth state toggles or provider remounts, effect runs again → disconnect then connect.

- **AuthLoadingGate — ui-preferences**  
  - Deps: `[isLoading, isAuthenticated]`.  
  - Stable for a single mount; repeated only if the gate remounts (ref resets).

---

## 3. Components that can mount/unmount repeatedly

- **AuthLoadingGate**  
  - Wraps app under `LayoutShell`; unmounts only if parent (e.g. LayoutShell) unmounts or key changes. If it does remount, ui-preferences fetch runs again.

- **RequireAuth**  
  - Wraps route content; remounts when navigating between protected routes. Does not wrap ChatAdapterProvider (provider is above routes in App.jsx), so route changes alone don’t remount the provider.

- **SessionSwitchListener**  
  - Renders nothing; no direct fetch. No repeated API by itself.

- **ChatAdapterContext (ChatAdapterProvider)**  
  - Mounted once in App (wraps Routes). If something above it (e.g. AuthLoadingGate, ErrorBoundary) remounts, the provider remounts → WS effect cleanup (disconnect) then effect run (connect) → WS reconnect; also all internal effects re-run (e.g. GET /api/users, and indirectly loadChats via ChatRoot).

- **ChatRoot**  
  - Mounted when route is /chat. Unmount/remount on route change; when remounting, its `loadChats` effect runs again (one more /api/chats).

- **Sidebar**  
  - Child of ChatRoot; does not call /api/chats or /api/users directly (uses context). No direct repeated fetch from Sidebar.

---

## 4. DEV-only regression guard (current)

- **lib/http.js**  
  - TEMP count/stack logging was removed.  
  - Lightweight DEV-only guard: if `/api/chats` (list) is called more than 2 times within a 2s window, `console.warn` once with a pointer to this doc. Counter resets every 2s; non-fatal.

- **transport/wsClient.js**  
  - TEMP count/stack logging in `connect()` was removed.

---

## 5. Expected top 3 call stacks causing repeated calls

From the code flow, the most likely stacks are:

1. **FETCH /api/chats**  
   - `apiFetch` → `getChats` (chat.api.js) → `loadChats` (ChatAdapterContext) → (invoked from) ChatRoot `useEffect` (because `loadChats` identity changed).

2. **FETCH /api/users**  
   - `apiFetch` → (either) ChatAdapterContext `useEffect` (directory fetch), or (or both) `loadChats` path that does per-user `apiFetch(\`/api/users/${userId}\`)` for hydration.

3. **WS CONNECT**  
   - `connect` (wsClient.js) → ChatAdapterContext `useEffect` (ws effect) that runs when `[isAuthenticated, authLoading]` cause the effect to re-run (or component to remount).

---

## 6. State update that triggers the rerender loop

- **Main loop (chats + users):**  
  1. ChatRoot effect runs and calls `loadChats()`.  
  2. `loadChats()` calls `getChatsApi()` → GET /api/chats, then for missing users calls `apiFetch(\`/api/users/${id}\`)` and `mergeUsersFromSearch(fetchedUsers)`.  
  3. `mergeUsersFromSearch` calls `setUsersById(...)` and `setUsers(...)`.  
  4. **State update:** `usersById` (and `users`) change.  
  5. `loadChats` is `useCallback(..., [isAuthenticated, usersById, mergeUsersFromSearch])` → **new `loadChats` identity**.  
  6. Context `value` useMemo depends on `loadChats` → new context value.  
  7. ChatRoot re-renders, `useEffect([loadChats, isAuthenticated], ...)` sees `loadChats` changed → runs again.  
  8. `loadChats()` is called again → back to step 2.  

So the **triggering state update** is **`setUsersById` / `setUsers`** inside `mergeUsersFromSearch`, which is called from `loadChats` after fetching chats and hydrating users. That makes `loadChats`’ dependency `usersById` change, so `loadChats` identity changes and ChatRoot’s effect re-invokes `loadChats` in a loop.

---

## 7. Root-cause summary

- **Repeated /api/chats and /api/users:**  
  - **Cause:** `loadChats` (ChatAdapterContext) depends on `usersById`.  
  - `loadChats` itself updates `usersById` via `mergeUsersFromSearch` after GET /api/chats and per-user GET /api/users.  
  - So each run of `loadChats` changes `usersById` → new `loadChats` → ChatRoot’s effect (which depends on `loadChats`) runs again → `loadChats()` again → loop.

- **Repeated ui-preferences:**  
  - **Cause:** Either AuthLoadingGate remounting (ref reset → effect runs again) or `isLoading`/`isAuthenticated` toggling (effect deps). Less likely than the chats/users loop unless auth or layout is unstable.

- **Repeated WS connect:**  
  - **Cause:** ChatAdapterContext’s WS effect depends on `[isAuthenticated, authLoading]`. If those flip (e.g. auth init or state updates) or the provider remounts, cleanup runs `disconnect()` and the next run calls `connect()` again.

**Recommended fix (chats/users loop):**  
- Remove `usersById` from `loadChats`’ dependency array.  
- Inside `loadChats`, use a **ref** (e.g. `usersByIdRef.current`) to read the latest `usersById` when deciding which users to fetch and when calling `mergeUsersFromSearch`, so that `loadChats` identity does not depend on `usersById`.  
- Keep `loadChats` depending only on `isAuthenticated` and, if needed, a stable `mergeUsersFromSearch` (e.g. ref or wrapped in useCallback with stable deps), so ChatRoot’s effect does not re-run on every `usersById` update.

---

## 8. What was changed (fixes applied)

- **ChatAdapterContext.jsx**
  - **usersByIdRef:** Added ref that mirrors `usersById` via `useEffect`; `loadChats` reads `usersByIdRef.current` for hydration instead of `usersById`, so `loadChats` no longer depends on `usersById`.
  - **loadChats deps:** `useCallback(..., [isAuthenticated, mergeUsersFromSearch])` — removed `usersById` to break the loop.
  - **Stable mergeUsersFromSearch:** Already used functional setState only; left as `useCallback(..., [])`.
  - **In-flight + request-id:** `loadChatsReqIdRef`, `loadChatsInFlightRef` — prevent concurrent runs and stale overwrites; only apply results when `reqId === loadChatsReqIdRef.current`.
  - **Hydration dedupe:** `loadChatsHydrationRequestedRef` (Set) — per run, don’t fire duplicate `/api/users/:id` for the same userId.
  - **DM creation:** Removed `setTimeout(() => loadChatsRef.current?.(), 800)` from `setApiChats` updater; optimistic update only.
- **ChatRoot.jsx**
  - **Run-on-auth guard:** `didLoadRef` + effect deps `[isAuthenticated]` only; call `loadChatsRef.current?.()` once when `isAuthenticated` becomes true, reset ref on logout. No dependency on `loadChats` identity.
- **GET /api/users effect (ChatAdapterContext)**
  - Deps reduced to `[isAuthenticated, authLoading, authUser?.id]`; added guard `if (authUser?.id == null) return;` so profile/avatar edits don’t refetch.
- **WS (ChatAdapterContext + wsClient)**
  - Effect only connects when `isAuthenticated === true && authLoading === false`; `connect()` is idempotent (return if already CONNECTING/OPEN); `disconnect()` / `shutdown()` clear `authReconnectTimer`; `onAuthChanged` skips `scheduleWsReauthReconnect` for `reason === 'login'` so React effect is sole owner of initial connect.
- **AuthLoadingGate**
  - Effect guard order: `hydratedRef` → `isLoading` → `!isAuthenticated`; set `hydratedRef.current = true` before fetch; reset ref when `!isAuthenticated`.

---

## 9. How to verify (expected counts)

- **Full app load (login or refresh on /chat):**
  - GET `/api/chats`: **1** (ChatRoot run-on-auth once).
  - GET `/api/users` (directory): **1** (ChatAdapterContext effect when auth ready).
  - GET `/api/me/ui-preferences`: **1** (AuthLoadingGate once when authenticated).
  - WS connect: **1** (ChatAdapterContext effect when auth ready).
- **Creating multiple DMs quickly:** no extra `/api/chats` (optimistic only; in-flight guard prevents overlapping loadChats).
- **Profile/avatar edit:** no extra GET `/api/users` (stable deps).
- **Logout:** no new fetches; WS disconnect.
- **Re-login:** again 1× chats, 1× users, 1× ui-preferences, 1× WS connect.

If you see the DEV warning “Possible /api/chats regression: >2 calls within 2 s”, check this doc and the callsites in §1–2.
