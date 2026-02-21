# Auth Reset Evidence Report (401 → handleSessionExpired)

**Purpose:** Capture the exact 401 path and reproduce the "Admin panel resets" behaviour deterministically. No code changes—evidence and code trace only.

**Suspected cause:** A 401 on a session-protected request triggers `handleSessionExpired()` in `myfrontend/frontend/src/lib/http.js`, which clears auth and redirects to `/login`.

---

## 1. Repro steps (exact checklist)

Use **one host only** for the first run; stick to it.

- [ ] **Option A:** Open frontend at **http://localhost:5173**  
  **OR**  
- [ ] **Option B:** Open frontend at **http://127.0.0.1:5173**

Then:

1. **Login** (valid credentials).
2. Navigate to **/admin**.
3. **DevTools:**
   - **Network:** Preserve log **ON**.
   - **Application → Cookies:** Note which cookies exist for the frontend origin (e.g. `token`, `refresh_token`).
4. **Hard refresh** on `/admin` (Cmd+R or Ctrl+R).

---

## 2. Evidence to capture

### 2.1 First request that returns 401

From the **Network** tab (Preserve log ON), identify the **first** request with status **401**.

| Field | Value |
|-------|--------|
| **First 401 URL** | _(e.g. GET /api/me or GET /api/admin/dashboard)_ |
| **Method** | |
| **Status** | 401 |
| **Response body snippet** | _(e.g. `{"success":false,"code":"UNAUTHORIZED"}`)_ |

**Likely candidates (in load order):**

- **GET /api/me** — Called by `runAuthInitOnce()` → `getCurrentUser()` before any route renders (AuthLoadingGate blocks until this completes).
- **GET /api/admin/dashboard** — Called after auth init, when the admin dashboard mounts.
- **GET /api/admin/users** — If the admin UI loads the users list early.

### 2.2 Refresh attempt

| Field | Value |
|-------|--------|
| **Was POST /api/auth/refresh called?** | Yes / No |
| **If yes, refresh response status** | _(e.g. 200, 401, 403)_ |
| **After refresh: was the original request retried?** | Yes / No |
| **If retried, retry response status** | _(e.g. 200, 401)_ |

### 2.3 Failing request (the first 401) — headers

**Request headers:**

| Header | Present? | Value / note |
|--------|----------|----------------|
| **Origin** | | _(e.g. http://localhost:5173)_ |
| **Cookie** | Yes / No | _(If present: list cookie names only, e.g. token; refresh_token)_ |

**Response headers:**

| Header | Present? | Value / note |
|--------|----------|----------------|
| **Set-Cookie** | Yes / No | _(If present: note Secure, SameSite, Path, Domain if any)_ |

### 2.4 Host mismatch test

- If you used **localhost** first: open **http://127.0.0.1:5173**, login → /admin → hard refresh.
- If you used **127.0.0.1** first: open **http://localhost:5173**, login → /admin → hard refresh.

**Application → Cookies:**

| Host | Cookies stored? | Names (e.g. token, refresh_token) |
|------|------------------|-----------------------------------|
| http://localhost:5173 | | |
| http://127.0.0.1:5173 | | |

Cookies without a `Domain` attribute are **host-only**: `localhost` and `127.0.0.1` have **separate** cookie jars. Logging in on one and refreshing on the other will not send the cookie → 401 → refresh → redirect.

---

## 3. Code trace (no edits)

### 3.1 useAuth.js — `runAuthInitOnce()` and `getCurrentUser()`

**File:** `myfrontend/frontend/src/hooks/useAuth.js`

- **runAuthInitOnce()** (lines 14–27): Singleton promise that sets `isLoading: true`, then calls **getCurrentUser()**, then sets auth state from the result and `isLoading: false`.
- **getCurrentUser()** is from `@/http/auth.api`: it calls **apiFetch("/api/me")** and returns `json?.data?.user ?? null`; on `UnauthorizedError` it returns `null` (auth.api.js lines 11–20).

So the **first** session-protected request on every load is **GET /api/me**, triggered by AuthLoadingGate → useAuth → runAuthInitOnce → getCurrentUser → apiFetch("/api/me").

### 3.2 http.js — 401 handling, refresh, handleSessionExpired

**File:** `myfrontend/frontend/src/lib/http.js`

- **apiFetch()** (lines 76–219):
  - Uses **credentials: 'include'** in cookie mode (line 96) so cookies are sent with every /api request.
  - **apiBaseUrl()** (lines 71–74): Uses `window.location.origin`, so requests go to the same origin as the page (no cross-origin by default).

- **On 401** (lines 101–195):
  - **No refresh** for: `/api/login`, `/api/register`, `/api/forgot`, `/api/reset`, `/api/auth/refresh`, or if **alreadyRetried** or **devTokenMode** → calls **handleSessionExpired()** and throws (lines 136–144).
  - **GET /api/me** is **not** in the no-refresh list → **refresh is attempted** on /api/me 401.
  - Refresh: **POST /api/auth/refresh** with `credentials: 'include'`, `body: '{}'` (lines 147–160).
  - If refresh returns **401 or 403** → **handleSessionExpired()**, then throw (lines 169–175).
  - If refresh returns **200** → **emitAuthChanged('refresh')** and **retry** the original request with `__retried: true` (lines 177–183).
  - If refresh fails (network) or returns other non-2xx → **emitAuthChanged('auth_degraded')**, do **not** redirect; throw (lines 161–166, 185–195).

- **handleSessionExpired()** (lines 31–42):
  - Shuts down WS (`wsClient.shutdown('session_expired')`).
  - In dev token mode clears tokens; then **setAuthState({ user: null, isAuthenticated: false, isLoading: false, error: null })**.
  - If current path is not public (e.g. not /login, /register, /forgot, /reset), **window.location.assign('/login')**.

So the deterministic path for "admin panel reset" is:

1. First request (almost certainly **GET /api/me**) returns **401** (e.g. no cookie sent, or wrong host).
2. **POST /api/auth/refresh** is called; it also gets **401** (or 403) because the same cookie is missing/invalid.
3. **handleSessionExpired()** runs → redirect to **/login**.

---

## 4. Backend cookie config (for conclusion)

**File:** `backend/config/cookieConfig.js`

- **COOKIE_DOMAIN:** From env; if unset, cookies are **host-only** (no Domain attribute).
- **COOKIE_SECURE:** Default false in dev (so http:// works).
- **COOKIE_SAME_SITE:** Default `'Lax'`.
- **COOKIE_PATH:** `'/'`.

If **COOKIE_DOMAIN** is set, cookies can be shared across subdomains but may not be sent if the request host doesn’t match. If unset, **localhost** and **127.0.0.1** are different hosts and do **not** share cookies.

---

## 5. Conclusion (fill after evidence)

| Hypothesis | Evidence for/against |
|------------|----------------------|
| **Host mismatch** (e.g. logged in on localhost, then opened or refreshed on 127.0.0.1) | _e.g. Cookie present on one host, missing on the other; first 401 on GET /api/me with no Cookie header on the second host._ |
| **Cookie flags** (Secure / SameSite / Domain / Path) | _e.g. Set-Cookie with Domain or Secure in dev causing cookie not to be sent._ |
| **Refresh logic** (refresh not called, or refresh 401 not retrying) | _e.g. First 401 is GET /api/me; refresh was called; refresh returned 401 → handleSessionExpired; no retry expected._ |

**Summary:**  
_The first 401 is expected to be **GET /api/me**. If the **Cookie** header is missing on that request (e.g. host-only cookies and different host), **POST /api/auth/refresh** will also be sent without the cookie and return 401, after which **handleSessionExpired()** runs and the app redirects to **/login**. So the “admin panel reset” is an **auth reset** driven by that 401 path and refresh failure._

---

## 6. Quick reference — 401 flow in http.js

```
apiFetch() → 401
  → isAuthEndpointNoRefresh (login/register/forgot/reset/refresh) OR alreadyRetried OR devTokenMode?
      → YES: handleSessionExpired() → redirect /login
  → ELSE: POST /api/auth/refresh (credentials: include)
      → refresh 401/403: handleSessionExpired() → redirect /login
      → refresh 200: retry original request (__retried: true)
      → refresh other/network: auth_degraded, throw (no redirect)
```

**GET /api/me** is not in `isAuthEndpointNoRefresh`, so **GET /api/me** 401 **does** trigger the refresh attempt, then redirect only if refresh returns 401/403.
