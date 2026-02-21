# Goal A Implementation Guide

Single reference for Admin wiring, contracts, and completion status. Prevents UI/backend mismatch.

---

## Goal A Completion Status

- **Dashboard** — Complete. Cards, chart (timeseries), activity panel, and stats badges are backend-driven. Empty timeseries renders one placeholder point without errors.
- **Users** — Complete. Directory, search, user detail, and Active Sessions from API. Empty users list shows "No users found."
- **Reports (list + resolve)** — Complete. List and detail from GET /api/admin/reports; message context availability from `hasMessageContext`; Resolve calls POST /api/admin/reports/:id/resolve and refetches. Empty list shows "No reports."

All admin data is backend source of truth. No dummy data dependency; no notAvailable stubs in normal operation. Bounded queries: reports ≤200, sessions ≤20, dashboard timeseries ≤96 buckets, dashboard activity limit ≤50.
