# Login Blocker — Why Real Auth May Fail

This doc captures reasons the standard login (`POST /api/login`) may return 401 "Invalid username or password", so real auth can be fixed later.

## Current Contract

- **Frontend**: `Login.jsx` → `useAuth().login({ username, password })` → `loginUserApi()` → `POST /api/login` with JSON body `{ username, password }`
- **Backend**: `POST /api/login` in `auth.routes.js`, handler in `auth.controller.js`
- **Expects**: `username`, `password` in `req.body`
- **Validation**: `userService.validateCredentials(username, password)` → `userStore.findByUsername()` + bcrypt compare

## Likely Causes of 401

1. **No users seeded**  
   `user.store.js` is in-memory. If no users were registered, `findByUsername()` returns null → 401.

2. **Password mismatch**  
   If user was created with a different password or bcrypt hash is wrong, `bcrypt.compare()` fails → 401.

3. **Field mismatch**  
   If frontend sends `email` instead of `username`, backend expects `username` → validation may fail.

4. **Credentials not sent**  
   `apiFetch` uses `credentials: "include"` — ensure login POST also does. Current `auth.api.js` uses `apiFetch`, which includes credentials.

## Path + Method

- Frontend: `POST /api/login`
- Backend: `router.post('/login', ...)` mounted under `/api` → `POST /api/login`
- Path and method match.

## Dev Bypass

Use "Dev Login as USER/ADMIN" on `/login` when `VITE_ENABLE_DEV_SESSION=true` and `DEV_SESSION_KEY` is set in backend env. This mints a session cookie without password validation.
