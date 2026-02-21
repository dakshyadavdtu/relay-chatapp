# CORS preflight + login verification (Vercel preview → Render backend)

Use this checklist in **browser DevTools** to confirm CORS and cookies work after setting `CORS_ORIGINS` on Render (Phase 3).

---

## 1) Preflight (OPTIONS) — response headers

1. Open your **Vercel preview URL** (e.g. `https://relay-chatapp-vercel-frontend-<branch>-<team>.vercel.app`).
2. **Hard refresh**: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows).
3. Open **DevTools → Network**.
4. Trigger a request that causes a preflight (e.g. go to login page or any API call with credentials).
5. In the list, find the **OPTIONS** request for `/api/health` or `/api/login` (or the API base URL your frontend uses).
6. Click it → **Headers** tab → **Response Headers**.

**Required:**

| Header | Expected value |
|--------|----------------|
| **Access-Control-Allow-Origin** | `https://relay-chatapp-vercel-frontend-<something>.vercel.app` (must match the page origin exactly) |
| **Access-Control-Allow-Credentials** | `true` |

- Status should be **204** (or 200). If OPTIONS is missing or blocked, CORS is misconfigured.
- If `Access-Control-Allow-Origin` is missing or `*`, the backend is not reflecting your origin (check Render `CORS_ORIGINS` and redeploy).

---

## 2) POST /api/login — not blocked by CORS

1. On the same Vercel preview origin, try to **log in** (submit the login form).
2. In **Network**, select the **POST** request to `/api/login`.

**Expected:**

- Status **200** (or 201) on success (not blocked by CORS).
- No console error like “blocked by CORS policy” or “No 'Access-Control-Allow-Origin' header”.
- Response may include `Set-Cookie` (see step 3).

If you see **403** with `CSRF_BLOCKED`, the request `Origin` is not in the backend allowlist — confirm backend logs show your origin in the allowlist and that Render env `CORS_ORIGINS` includes the wildcard pattern.

---

## 3) Cookies after successful login

1. After a **successful** login, open **DevTools → Application** (Chrome) or **Storage** (Firefox).
2. **Cookies** → select your **backend origin** (e.g. `https://relay-chatapp.onrender.com` or whatever your API host is).

**Expected:**

- At least one cookie set by the backend (e.g. `token` or the name in `JWT_COOKIE_NAME`).
- If the frontend uses a different domain (Vercel) than the API (Render), cookies are stored for the **API domain** (Render); the browser sends them only to that host. That is correct for cross-origin auth.

If no cookies appear:

- Confirm login response status is 2xx and response has `Set-Cookie`.
- Check **Application → Cookies** for the **backend** origin, not the Vercel origin.
- Ensure backend is not setting `SameSite=Strict` in a way that prevents cross-site send (backend uses `SameSite=None` in production when appropriate).

---

## Quick checklist

| Step | Check | Pass / Fail |
|------|--------|-------------|
| 1 | Hard refresh on Vercel preview URL | |
| 2 | OPTIONS preflight for `/api/health` or `/api/login` present in Network | |
| 3 | Response has `Access-Control-Allow-Origin: <your-preview-origin>` | |
| 4 | Response has `Access-Control-Allow-Credentials: true` | |
| 5 | POST /api/login returns 2xx (not CORS-blocked, not 403 CSRF_BLOCKED) | |
| 6 | After login, cookies visible for backend host in Application → Cookies | |

---

[verification/README.md](README.md) · [00_INDEX.md](../00_INDEX.md)
