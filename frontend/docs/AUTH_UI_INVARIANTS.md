# Auth UI Invariants + Allowed Edits

**Reference:** auth_migration_master_plan_doc_765a82da.plan.md — Phase 0  
**Purpose:** Preserve the updated_auth look while fixing logic. This checklist defines what must stay, what to remove, and what to add. **No implementation changes in this phase — doc only.**

---

## 1. Screens to preserve

These auth routes must keep their current visual design (layout, card, typography, spacing, gradients, button styles):

| Route        | Screen        | Notes                    |
|-------------|---------------|--------------------------|
| `/login`    | Login         | Username + Password      |
| `/register` | Sign Up       | Username + Password + Confirm (see Add below) |
| `/forgot`   | Forgot Password | Single field (see Add below) |
| `/verify-otp` | Verify OTP  | OTP input + resend        |
| `/reset`    | Reset Password | New + Confirm password |

---

## 2. UI elements to REMOVE (explicit user request)

### a) "Back to Chat" link on auth pages

- **Where:** Login, Register, Forgot, Reset (and any other auth page that shows it).
- **Action:** Remove the "Back to Chat" link/label from all auth screens.
- **Keep:** All other links (e.g. "Log in", "Sign up", "Forgot password?", "Back to Sign In") unchanged.

### b) Settings icon + top header strip on auth routes

- **Where:** The global header / top strip (e.g. LayoutShell / GlobalHeader) when the user is on an auth route.
- **Action:** Do not show the settings icon or the top header strip on auth routes (`/login`, `/register`, `/forgot`, `/verify-otp`, `/reset`).
- **Note:** Implementation may be “hide header on auth routes” or “auth routes render without LayoutShell”; either way, no settings icon and no top header on these screens.

---

## 3. UI elements to ADD (explicit user request)

### a) Email field on Sign Up page (above Username)

- **Where:** `/register` (Sign Up page).
- **Action:** Add an **Email** field **above** the Username field.
- **Keep:** All existing fields (Username, Password, Confirm Password), card layout, typography, spacing, and button styles. Only add the Email field and place it above Username.

### b) Send OTP feature must actually work (Forgot / VerifyOTP / Reset flow)

- **Where:** Forgot Password → Verify OTP → Reset Password.
- **Action:** The flow must be functional end-to-end:
  - **Forgot:** Submitting the form (e.g. with email or username, per backend) actually triggers “send OTP” (backend integration).
  - **Verify OTP:** User can enter OTP; verification calls backend and on success proceeds to Reset (or to login, per product rules).
  - **Reset:** User sets new password; submit calls backend and completes the flow (e.g. redirect to login).
- **Keep:** Existing UI layout, card, typography, spacing, and button styles for Forgot, Verify OTP, and Reset. Only the logic/API wiring must be implemented so the feature works.

---

## 4. UI elements to KEEP

Do **not** change:

- **Card layout:** Auth card (title, subtitle, form area), width, padding, border radius, shadow.
- **Typography:** Font sizes, weights, and hierarchy for titles, subtitles, labels, links, and error text.
- **Spacing:** Vertical/horizontal gaps between sections, fields, and buttons (e.g. `space-y-4`, `space-y-6`, margins).
- **Gradients and backgrounds:** Page background (e.g. `#ffefdf` / dark variant), left-panel image (if any), gradient or color usage.
- **Button styles:** Primary/secondary/loading styles, size, border radius, hover states.
- **Input styles:** Borders, focus rings, placeholder and error state styling.
- **Footer:** Auth footer (e.g. “© 2026 Relay — built by …”) unchanged.
- **Links:** Styling of “Log in”, “Sign up”, “Forgot password?”, “Back to Sign In” (only “Back to Chat” is removed per section 2).

---

## 5. Summary

| Category   | Items |
|-----------|--------|
| **Screens to preserve** | `/login`, `/register`, `/forgot`, `/verify-otp`, `/reset` (current look) |
| **Remove**             | (a) “Back to Chat” on auth pages; (b) Settings icon + top header strip on auth routes |
| **Add**                | (a) Email field on Sign Up (above Username); (b) Working Send OTP flow (Forgot → VerifyOTP → Reset) |
| **Keep**               | Card layout, typography, spacing, gradients, button/input styles, footer, non–Back-to-Chat links |

No implementation changes in this phase — this document is the checklist for later edits.
