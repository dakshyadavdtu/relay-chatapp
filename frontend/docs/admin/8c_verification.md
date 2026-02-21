# Phase 8C — Admin Verification Checklist

## 1) Backend Endpoint Shape

```bash
# Diagnostics must return success wrapper (not raw object)
curl -i -H "x-dev-user: dev_user" http://localhost:8000/api/admin/diagnostics/dev_user
```

**Expected:** 200 OK, body `{"success":true,"data":{"userId":"dev_user","snapshot":{...},"timestamp":...}}`

(With real auth: use valid JWT cookie instead of x-dev-user.)

---

## 2) Frontend Navigation

1. Go to `/admin/users`
2. Select a user from the list
3. Click **View Diagnostics**
4. **Expected:** Navigate to `/admin/diagnostics/<userId>` (not `/admin/users/<id>`)

---

## 3) Error Correctness

- **Non-admin (403):** UI shows "Admin role required" or "Access denied (requires ADMIN)" — not "API not found" or "404"
- **Unauthenticated (401):** UI shows "Login required"
- **True 404 (e.g. diagnostics for non-existent user):** UI shows "Not found"

---

## 4) Confirm No Telemetry

```bash
rg -n "7253|ingest|analytics" myfrontend/frontend/src/features/admin
```

**Expected:** No matches (admin feature must not use direct fetch to analytics/ingest endpoints)
