# Phase 5 Security: Mock Auth/Chat Production Lockout

## What Changed

- **Guard helper** `src/contracts/flags.js`:
  - `isProd()` – `true` when `import.meta.env.PROD === true`
  - `allowMockAuth()` – mock auth only in **dev** when `VITE_USE_MOCK_AUTH === "true"`; **always false in prod**
  - `allowMockChat()` – mock chat only in **dev** when `VITE_USE_MOCK_CHAT === "true"`; **always false in prod**
  - In production builds, `VITE_USE_MOCK_AUTH` and `VITE_USE_MOCK_CHAT` are ignored; a console warning is shown if they are set

- **Auth API** (`src/http/auth.api.js`): All mock paths use `allowMockAuth()` instead of direct env checks.

- **Chat** (`ChatAdapterContext.jsx`, `NewGroupPopup.jsx`, `JoinRoomPopup.jsx`): All mock paths use `allowMockChat()` instead of direct env checks.

## Dev vs Prod Behavior

| Mode | `VITE_USE_MOCK_AUTH=true` | `VITE_USE_MOCK_CHAT=true` |
|------|---------------------------|---------------------------|
| Dev  | Mock auth used            | Mock chat used            |
| Prod | Ignored, real auth only   | Ignored, real chat only   |

## How to Verify

### A) Dev with mock auth enabled

```bash
cd myfrontend/frontend
VITE_USE_MOCK_AUTH=true npm run dev
```

- App should use mock auth (mock login, bypass `/api/me`).

### B) Production build with mock env set – must use real auth

```bash
cd myfrontend/frontend
VITE_USE_MOCK_AUTH=true npm run build
npm run preview
```

- App must **not** use mock auth.
- Login/me must go to real `/api/login` and `/api/me`.
- Console may show: `[SECURITY] VITE_USE_MOCK_AUTH and VITE_USE_MOCK_CHAT are ignored in production builds.`

### C) Production build with mock chat env set – must use real chat

```bash
cd myfrontend/frontend
VITE_USE_MOCK_CHAT=true npm run build
npm run preview
```

- App must **not** use mock chat (real WebSocket/API only).

## Files Changed

- `src/contracts/flags.js` (new)
- `src/http/auth.api.js` (updated)
- `src/features/chat/adapters/ChatAdapterContext.jsx` (updated)
- `src/features/chat/ui/NewGroupPopup.jsx` (updated)
- `src/features/chat/ui/JoinRoomPopup.jsx` (updated)
