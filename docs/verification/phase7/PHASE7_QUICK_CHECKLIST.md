# PHASE 7 — Quick Verification Checklist

**Quick reference for manual testing**

---

## A) Suspicious Flags — Quick Test

### 1. Verify Polling (30 seconds)
- [ ] Open `/admin/dashboard`
- [ ] Open DevTools → Network → Filter `/api/admin/dashboard`
- [ ] Verify:
  - `GET /api/admin/dashboard` called every ~10s
  - `GET /api/admin/dashboard/stats` called every ~5s
  - `GET /api/admin/dashboard/activity` called every ~4s

### 2. Trigger Flag (2 minutes)
- [ ] Open WebSocket connection (chat page)
- [ ] Send >100 messages rapidly (or throttle network + spam)
- [ ] Check dashboard: `suspiciousFlags` should increase
- [ ] Check activity feed: should show "flag" event

### 3. Verify Stats (30 seconds)
- [ ] Check stats badge: `suspiciousFlagsDeltaLastHour` should update
- [ ] Wait 60s for buffer sample
- [ ] Verify delta reflects increase

**Expected Results:**
- Dashboard: `suspiciousFlags > 0`
- Stats: `suspiciousFlagsDeltaLastHour` updates
- Activity: Shows "flag" events

---

## B) Role Toggle — Quick Test

### 1. Login as Root (30 seconds)
- [ ] Login with root admin (email matching `ROOT_ADMIN_EMAIL`)
- [ ] Verify `/api/me` returns `isRootAdmin: true`
- [ ] Navigate to `/admin/users`

### 2. Make Admin (1 minute)
- [ ] Select non-admin user
- [ ] Click "Make Admin"
- [ ] Verify toast: "User promoted"
- [ ] Verify user role changes to "admin"
- [ ] **Critical:** Open new tab, login as promoted user
- [ ] Navigate to `/admin/dashboard` → Should work (no 403)

### 3. Revoke Admin (1 minute)
- [ ] Return to root tab
- [ ] Select admin user (the one you promoted)
- [ ] Click "Revoke Admin"
- [ ] Verify toast: "Admin revoked"
- [ ] Verify user role changes to "user"
- [ ] In promoted user's tab, refresh `/admin/dashboard`
- [ ] Should get 403 or redirect

### 4. Verify Guards (1 minute)
- [ ] Select root user → Button shows "Root (locked)" (disabled)
- [ ] Select self → Button disabled, tooltip shows "You cannot change your own role"
- [ ] Login as non-root admin → Button not visible
- [ ] Try manual API call as non-root → Should get 403

**Expected Results:**
- Root can toggle roles
- Promoted user gains access immediately (no logout needed)
- Demoted user loses access immediately
- Guards prevent unauthorized changes

---

## Total Time: ~6 minutes

**Full details:** See `PHASE7_E2E_VERIFICATION.md`
