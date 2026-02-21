# Auth diagnostics — "Why did I get logged out?"

DEV-only tools to see why the app redirected to `/login`: cookie missing, host mismatch, cookie flags, or refresh endpoint failing. No secrets are returned.

---

## 1. Console log on redirect

When `handleSessionExpired()` runs (redirect to `/login`), the frontend logs a structured summary **before** redirect so you can see what failed:

- **path** — Current pathname when logout happened (e.g. `/admin`).
- **lastFailedUrl** — The request URL that got 401 (or the refresh URL if refresh returned 401/403).
- **lastStatus** — HTTP status (401 or 403).
- **host** — Browser host (e.g. `localhost:5173`). If you see `127.0.0.1` here but you logged in on `localhost`, that’s a host mismatch.
- **cookiePresent** — `undefined` (client cannot read httpOnly cookies; use the debug endpoint to see if the backend received cookies).

**Where:** DevTools Console. Look for:

```text
[auth] session expired (redirecting to /login). Why? Run auth diagnostic on /login. { path, lastFailedUrl, lastStatus, host, cookiePresent }
```

**Usage:** Reproduce the logout (e.g. hard refresh on `/admin`, or open 127.0.0.1 after logging in on localhost), then check the console. Use the diagnostic button (below) for full backend view.

---

## 2. "Why did I get logged out?" button (DEV only)

A button on **/login** and in the **Admin** sidebar (bottom) calls the backend diagnostic and shows the result.

**Steps:**

1. After you get redirected to `/login` (or while on `/admin`), click **"Why did I get logged out?"**.
2. The app calls `GET /api/dev/debug/auth` (with credentials so cookies are sent if any).
3. The response is **console.log**’d and shown in a small preformatted block below the button.

**Response shape (no secrets):**

| Field | Meaning |
|-------|--------|
| **nodeEnv** | Backend `NODE_ENV` (e.g. `development`). |
| **cookieConfigEffective** | `{ secure, sameSite, domain, path }` — same as backend startup log. |
| **requestHost** | Host header the backend saw (e.g. `localhost:5173` from Vite proxy). |
| **requestOrigin** | Origin header (if sent). |
| **hasSessionCookie** | `true` if the request had the session cookie (e.g. `token`). **false** = cookie missing (host mismatch or never set). |
| **hasRefreshCookie** | `true` if the request had the refresh cookie. **false** = missing. |
| **hint** | `"HOST_MISMATCH_LIKELY"` if request host differs from expected dev host (e.g. backend expects `localhost`, request came as `127.0.0.1`). |

**Interpretation:**

- **hasSessionCookie false, hasRefreshCookie false** → Cookies not sent. Likely host mismatch (e.g. logged in on `localhost`, now on `127.0.0.1`) or wrong domain/path/secure.
- **hint: HOST_MISMATCH_LIKELY** → Use `http://localhost:5173` only; clear cookies and log in again on the same host.
- **cookieConfigEffective.secure true** in local dev → Backend is setting `Secure`; cookies won’t be sent over `http://`. Set `COOKIE_SECURE=false` or run backend with `NODE_ENV=development`.
- **cookieConfigEffective.domain** set in dev → May prevent cookie from being sent to `localhost`. Leave unset (host-only) in dev.

---

## 3. Backend endpoint (DEV only)

- **URL:** `GET /api/dev/debug/auth`
- **Auth:** None. Intended for debugging after redirect to login.
- **When:** Only registered when `NODE_ENV !== 'production'`. Returns 404 in production.
- **Cookies:** Send with the request (`credentials: 'include'`) so the backend can report whether it received them. No cookie values are returned.

---

## 4. Validation checklist

After reproducing a logout:

1. **Console:** See `[auth] session expired` with `path`, `lastFailedUrl`, `lastStatus`, `host`.
2. **Button:** Click "Why did I get logged out?" on `/login` (or in admin sidebar).
3. **Check:** `hasSessionCookie` / `hasRefreshCookie` false → cookie missing (host or flags).
4. **Check:** `hint === 'HOST_MISMATCH_LIKELY'` → use one host only (e.g. `http://localhost:5173`).
5. **Check:** `cookieConfigEffective` → secure false, domain host-only in dev.
