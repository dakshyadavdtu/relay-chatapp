# Reset Classification Report

**Purpose:** Reproduce an observed "reset" and classify it as (A) Auth reset, (B) UI state reset, or (C) Live metrics reset.

---

## How to Reproduce

1. **Open frontend in browser and DevTools**
   - **Network:** Enable "Preserve log".
   - **Application:** Open Cookies for the frontend origin (e.g. `localhost:5173`).

2. **Load `/admin`**, then:
   - **a)** Change some UI state: e.g. on Admin Users set a search term or change page.
   - **b)** Go to `/chat`, then back to `/admin`.
   - **c)** Hard refresh (Cmd+R or F5).

3. **Observe and record below:**
   - Redirect to `/login`? → **A) Auth reset**
   - UI controls (search/filter/page) reset but you stayed on admin and logged in? → **B) UI state reset**
   - Dashboard numbers (cards/chart) become 0 but auth + UI stayed? → **C) Live metrics reset**
   - Optional: Restart backend, then reload `/admin` — do numbers go to 0? → **C) correlates with backend restart**

---

## Code Reference (what drives each reset)

### A) Auth reset

- **Frontend auth source:** `myfrontend/frontend/src/hooks/useAuth.js`
  - On app load, `runAuthInitOnce()` runs once and calls `getCurrentUser()` → **GET /api/me**.
  - If that fails (e.g. 401), auth state is set to unauthenticated; no redirect from the hook itself.
- **401 handling:** `myfrontend/frontend/src/lib/http.js`
  - On **401** from any `/api/*` request, `apiFetch` may try **POST /api/auth/refresh** once (cookie mode), then retry the original request.
  - If still 401 (or refresh not used): **`handleSessionExpired()`** runs:
    - `wsClient.shutdown('session_expired')`
    - Clears auth state: `setAuthState({ user: null, isAuthenticated: false, ... })`
    - **`window.location.assign('/login')`** (if not already on a public path).
- **Exact failing request(s) to record:** In Network tab, note which request returns **401** (often **GET /api/me** or **GET /api/admin/dashboard**). If refresh was attempted, also note **POST /api/auth/refresh** status.

### B) UI state reset

- **Admin UI state** is in React component state (e.g. `AdminUsersPage.jsx`):
  - Search: `useState("")` for `searchTerm` — **not** in URL.
  - Pagination/cursor: passed to API but typically not synced to URL.
- **When it’s lost:**
  - **Navigate away and back:** Component unmounts/remounts → state re-initializes → search/filter/page reset.
  - **Hard refresh:** Full reload → all React state lost → same effect.
- **What to record:** Which controls reset (e.g. “Admin Users search box”, “Reports filter”, “page/cursor”) and after which action (navigate away/back vs hard refresh).

### C) Live metrics reset

- **Dashboard cards (GET /api/admin/dashboard):**  
  `backend/http/controllers/admin.controller.js` → **getDashboard()** uses **observability.getSnapshot(capabilities)**.
- **Snapshot source:** `backend/observability/snapshot.js` → **assembleSnapshot()** reads:
  - **connectionsAggregator** (in-memory: connectionManager)
  - **messagesAggregator** (in-memory: message timestamps)
  - **latencyAggregator** (in-memory)
  - So **dashboard cards** (onlineUsers, messagesPerSecond, messagesLastMinute, latencyAvg, etc.) all come from **in-memory aggregators**.
- **Chart and badges:**  
  Timeseries and extended stats use **backend/observability/adminDashboardBuffer.js** — an **in-memory ring buffer** filled by `setInterval(sample, 60_000)`. No DB.
- **When numbers go to 0:**
  - **Backend restart:** New process → aggregators and buffer are empty → next GET /api/admin/dashboard and timeseries/stats return 0 or empty. **Auth and UI state unchanged** (no 401, no redirect, React state intact).
  - **Long inactivity:** If the backend process is killed or restarted for any reason (deploy, crash), same effect.
- **What to record:** Whether dashboard numbers (and chart) go to 0 **after backend restart** or after a period of inactivity, while you remain on `/admin` and logged in.

---

## Classification Checklist (fill after reproducing)

| Observation | A) Auth reset | B) UI state reset | C) Live metrics reset |
|-------------|----------------|-------------------|------------------------|
| Redirected to `/login`? | ☐ Yes | ☐ No | ☐ No |
| GET /api/me or other request returned 401? | ☐ Yes (note URL below) | ☐ N/A | ☐ N/A |
| Search/filter/page lost (e.g. Admin Users)? | ☐ N/A | ☐ Yes (note which) | ☐ N/A |
| Dashboard numbers → 0 / chart empty? | ☐ N/A | ☐ N/A | ☐ Yes |
| Backend restarted before metrics went to 0? | ☐ N/A | ☐ N/A | ☐ Yes / ☐ No |

---

## Your Result (template)

**Which of A / B / C is occurring?**  
_(e.g. “C) Live metrics reset — dashboard goes to 0 after backend restart.” or “A) Auth reset — GET /api/me returns 401 after hard refresh.”)_

- **If A — exact failing request(s):**  
  _(e.g. “GET /api/me → 401” or “GET /api/admin/dashboard → 401 after POST /api/auth/refresh → 401”.)_

- **If B — which UI state is lost:**  
  _(e.g. “Admin Users search term and pagination reset after navigating to /chat and back.”)_

- **If C — backend restart correlation:**  
  _(e.g. “Dashboard numbers and chart go to 0 within one poll after restarting the backend; no redirect, still logged in.”)_

---

## Summary

- **A) Auth reset:** 401 → `handleSessionExpired()` in `http.js` → redirect to `/login`. Check Network for 401 on /api/me or /api/auth/refresh.
- **B) UI state reset:** React state (search/filter/page) is not in URL; navigate or hard refresh remounts components and resets state.
- **C) Live metrics reset:** Dashboard and chart data come from in-memory aggregators and `adminDashboardBuffer`; backend restart (or process loss) clears them, so numbers go to 0 without any auth or UI reset.
