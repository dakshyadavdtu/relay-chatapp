# Phase 3.0 Parity Checklist

**Date:** 2026-02-11  
**Purpose:** Checkbox-style parity checklist for Auth, Chat, Settings, Admin, and cross-module navigation.

---

## Auth Checklist

| Status | Item | Evidence Path |
|--------|------|---------------|
| DONE | Login page exists | `src/pages/auth/Login.jsx` |
| DONE | Register page exists | `src/pages/auth/Register.jsx` |
| DONE | Forgot password page exists | `src/pages/auth/Forgot.jsx` |
| DONE | Reset password page exists | `src/pages/auth/Reset.jsx` |
| MISSING | OTP verification page exists | — |
| DONE | AuthLayout component | `src/components/auth/AuthLayout.jsx` |
| DONE | AuthCard component | `src/components/auth/AuthCard.jsx` |
| UNKNOWN | ProtectedRoute redirects to chat on auth | — |
| UNKNOWN | Auth state persists across refresh | — |
| NO | Auth handlers call real API | console.log only |

---

## Chat Checklist

| Status | Item | Evidence Path |
|--------|------|---------------|
| DONE | Sidebar component | `src/components/chat/Sidebar.jsx` |
| DONE | ChatWindow component | `src/components/chat/ChatWindow.jsx` |
| DONE | NewGroupPopup component | `src/components/chat/NewGroupPopup.jsx` |
| DONE | GroupInfoPanel component | `src/components/chat/GroupInfoPanel.jsx` |
| DONE | Chat entry page | `src/pages/ChatPlaceholder.jsx` |
| DONE | Link to Login in Sidebar | `components/chat/Sidebar.jsx` |
| DONE | Link to Settings in Sidebar | `components/chat/Sidebar.jsx` |
| DONE | Admin Panel button in Sidebar | `components/chat/Sidebar.jsx` |
| DONE | Settings modal openable from chat | `components/layout/SettingsModal.jsx` |
| NO | WebSocket integration for messages | mock only |
| NO | Groups from real API | mock only |

---

## Settings Checklist

| Status | Item | Evidence Path |
|--------|------|---------------|
| DONE | Settings route exists | `/settings` in routes |
| DONE | Settings page | `src/pages/Settings.jsx` |
| DONE | SettingsModal component | `src/components/layout/SettingsModal.jsx` |
| DONE | Theme toggle | SettingsModal |
| DONE | Text size option | SettingsModal |
| DONE | Density option | SettingsModal |
| DONE | Notification settings | SettingsModal |
| DONE | Export data option | SettingsModal |
| MISSING | SettingsLayout with sidebar | — |
| MISSING | Profile sub-page | — |
| MISSING | Security sub-page | — |
| MISSING | Devices sub-page | — |
| MISSING | Users sub-page | — |
| MISSING | Reports sub-page | — |
| MISSING | Preferences sub-page | — |
| MISSING | Connection sub-page | — |
| MISSING | Danger Zone sub-page | — |

---

## Admin Checklist

| Status | Item | Evidence Path |
|--------|------|---------------|
| DONE | Admin route exists | `/admin` in routes |
| DONE | Admin placeholder page | `src/pages/AdminPlaceholder.jsx` |
| DONE | Admin Panel modal in chat Sidebar | `components/chat/Sidebar.jsx` |
| MISSING | Admin layout with sidebar | — |
| MISSING | AdminRouteGuard | — |
| MISSING | Dashboard page | — |
| MISSING | Users page | — |
| MISSING | Reports page | — |
| MISSING | Admin-specific state | — |

---

## Cross-Module Navigation Checklist

| Status | Item | Evidence Path |
|--------|------|---------------|
| PARTIAL | Login to Chat link/nav | Manual only — no post-login redirect |
| DONE | Chat to Settings link | `Sidebar.jsx` href="/settings" |
| DONE | Chat to Admin link | Sidebar Admin Panel button (modal) + `/admin` route |
| DONE | Settings to Chat back link | `Settings.jsx` Link href="/chat" |
| NO | Auth to Chat redirect on login | not wired |
| UNKNOWN | Admin to Chat back link | — |
| DONE | Root `/` redirects to `/chat` | `routes.jsx` |

---

**Legend:** DONE = Present / Implemented | MISSING = Not present | PARTIAL = Partial | NO = Not implemented | UNKNOWN = Not verified
