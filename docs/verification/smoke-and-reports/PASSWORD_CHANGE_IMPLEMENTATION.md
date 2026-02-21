# Password Change Implementation

## Summary

Implemented real password change functionality to replace the mock implementation in Settings → Security page.

## Files Changed

### Backend

1. **`backend/http/controllers/auth.controller.js`**
   - Added `changePassword()` function
   - Validates current password, verifies it matches user's hash
   - Updates password hash using `userService.updatePassword()`
   - Returns appropriate error codes for validation failures

2. **`backend/http/routes/auth.routes.js`**
   - Added route: `PATCH /api/me/password`
   - Protected with `requireAuth` middleware
   - Rate limited with `authLimiter`

### Frontend

3. **`myfrontend/frontend/src/http/auth.api.js`**
   - Added `changePassword()` API function
   - Calls `PATCH /api/me/password` endpoint

4. **`myfrontend/frontend/src/hooks/useChangePassword.js`** (NEW FILE)
   - Created new hook `useChangePassword()`
   - Provides `mutate()` and `isPending` state
   - Handles error toasts automatically
   - Compatible with existing SecurityPage usage pattern

5. **`myfrontend/frontend/src/pages/settings/SecurityPage.jsx`**
   - Replaced `useMockChangePassword` import with `useChangePassword`
   - No other changes needed (same API)

## Implementation Details

### Backend Validation

- **Current password**: Required, must match user's existing password hash
- **New password**: Required, minimum 8 characters (matches UI requirement)
- **Error codes**:
  - `UNAUTHORIZED`: Not authenticated
  - `INVALID_REQUEST`: Missing required fields
  - `INVALID_PASSWORD`: Password validation failed or current password incorrect

### Security

- Uses `bcrypt.compare()` to verify current password (never stores plain text)
- Uses `userService.updatePassword()` which hashes new password before storage
- Protected by authentication middleware
- Rate limited to prevent brute force attacks

## Testing

### Manual Test Plan

1. **Login as a user**
   ```bash
   curl -X POST http://localhost:3000/api/login \
     -H "Content-Type: application/json" \
     -d '{"username":"testuser","password":"oldpassword"}' \
     -c cookies.txt
   ```

2. **Change password**
   ```bash
   curl -X PATCH http://localhost:3000/api/me/password \
     -H "Content-Type: application/json" \
     -b cookies.txt \
     -d '{"currentPassword":"oldpassword","newPassword":"newpassword123"}'
   ```

3. **Logout**
   ```bash
   curl -X POST http://localhost:3000/api/logout \
     -b cookies.txt
   ```

4. **Login with old password (should fail)**
   ```bash
   curl -X POST http://localhost:3000/api/login \
     -H "Content-Type: application/json" \
     -d '{"username":"testuser","password":"oldpassword"}'
   ```
   Expected: 401 Unauthorized

5. **Login with new password (should succeed)**
   ```bash
   curl -X POST http://localhost:3000/api/login \
     -H "Content-Type: application/json" \
     -d '{"username":"testuser","password":"newpassword123"}' \
     -c cookies.txt
   ```
   Expected: 200 OK with user data

### Frontend Test

1. Navigate to Settings → Security
2. Enter current password
3. Enter new password (must be >= 8 characters)
4. Confirm new password
5. Click "Update Password"
6. Verify success toast appears
7. Logout and login with new password
8. Verify old password no longer works

## Error Handling

### Backend Errors

- `400 INVALID_REQUEST`: Missing currentPassword or newPassword
- `400 INVALID_PASSWORD`: New password too short (< 8 chars) or current password incorrect
- `401 UNAUTHORIZED`: Not authenticated or user not found

### Frontend Errors

- Hook automatically shows error toast with message from backend
- Form validation (password match, length) handled in SecurityPage component
- Backend validation errors displayed to user

## Notes

- Password change does NOT invalidate existing sessions (user stays logged in)
- Password hash is updated immediately in database
- No password history or complexity requirements beyond minimum length
- UI validation (uppercase, lowercase, number) is informational only; backend only enforces length >= 8
