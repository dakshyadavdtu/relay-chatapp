# Auth: multi-tab and multi-account behavior

## Cookie mode (production; `VITE_DEV_TOKEN_MODE` not set)

- **Single account per browser:** The browser sends one cookie per origin. Logging in as a different user in another tab overwrites that cookie, so all tabs share the same session. Cookie mode **cannot** provide different accounts in different tabs.
- **Session-switched UX:** If another tab logs in as a different user, this tab detects it (via `localStorage.auth_user_id_last_seen` and the storage event) and shows a clear **"Another account was used in another tab. Please sign in again."** banner, then redirects to `/login?reason=session_switched`. This avoids a silent 401 and generic "logged out" message.
- **Backend:** The backend does **not** revoke existing sessions on login; multiple sessions (e.g. multiple tabs) remain valid until logout or expiry.

## Dev token mode (`VITE_DEV_TOKEN_MODE=true`)

- **Multi-account per tab:** Tokens are stored in **sessionStorage** (per-tab). Each tab can log in as a different user; WS URL and `Authorization` header read from that tab’s sessionStorage. Refresh token is also per-tab, so refresh uses the correct token for that tab.
- Use this for local development when you need UserA in one tab and UserB in another.

## Repro steps that work

**Cookie mode (session-switched):**
1. Tab1: log in as UserA. Tab2: log in as UserB.
2. Tab1: you should see the session-switched banner and redirect to login (or, if Tab1 makes a request and gets 401 with a different fingerprint, same message).
3. Log in again in Tab1 as needed.

**Dev token mode (multi-account):**
1. Set `VITE_DEV_TOKEN_MODE=true` and run the frontend.
2. Tab1: log in as UserA. Tab2: log in as UserB.
3. Both tabs stay logged in as their respective users; no session-switched redirect.
