# Behavioral Audit Report: mychat vs myfrontend

**Reference app:** `mychat original copy 6`  
**Target app:** `myfrontend`  
**Date:** February 10, 2025

---

## Executive Summary

This audit traces feature behavior end-to-end (UI → handler → state → side effects) in the reference app and compares it to the target app. No code changes were made; this is analysis and documentation only.

### Critical Missing Logic (High Risk)

- **Group creation flow** – Create button has no `onClick`; no `handleCreate`, no `createGroup` API, no `addGroup` or groups state update, no `setActiveGroupId` after creation.
- **Group thumbnail upload** – Thumbnail UI exists but no `<input type="file">`, no `handleThumbnailUpload`, no `FileReader`, no `thumbnailPreview` state.
- **Report on others’ messages** – No Report option in message dropdown for non-owned messages; no Report modal or toast.
- **Report user (DM header)** – No Flag button in header for DM chats; no Report User modal.

### Medium Priority Missing Behavior

- **Chat area dark mode** – Target ChatWindow main container uses `bg-[#EFEAE2]` without `dark:bg-[#0f172a]`; reference has both.
- **Groups data source** – Target Sidebar reads `MOCK_GROUPS` (hardcoded); reference uses React Query `["/api/groups"]` with `getGroups` API.

### Purely Visual / Low Risk

- Message bubble colors and shape (sent/received) are aligned; both use `bg-[#D9FDD3]` / `bg-white` with dark variants.
- Settings modal structure and dark mode toggle are implemented in both.

---

## Detailed Feature Matrix

| Feature | Reference UI Location | Reference Logic Location | Reference State Location | Target Status | Missing Parts | Risk |
|--------|------------------------|--------------------------|---------------------------|---------------|---------------|------|
| **Group creation** | `mychat/.../NewGroupPopup.jsx` | `handleCreate` → `createGroupMutation.mutate`; `createGroup` from `@/api/endpoints` | React Query `["/api/groups"]`; `queryClient.setQueryData`; `setActiveGroupId` | **Partially implemented** | Create button has no `onClick`; no `handleCreate`; no `createGroup` API; no groups API or React Query; groups from `MOCK_GROUPS` | **High** |
| **Group thumbnail upload** | `mychat/.../NewGroupPopup.jsx` | `handleThumbnailUpload` → `FileReader.readAsDataURL` → `setThumbnailPreview`; passed in `payload.thumbnailUrl` | Local `thumbnailPreview` state | **Partially implemented** | No file input; no `handleThumbnailUpload`; no `thumbnailPreview`; "Upload image" span not wired to input | **High** |
| **Message hover: Edit** | `mychat/.../ChatWindow.jsx` | `handleStartEdit` → `handleSaveEdit` → `transportEditMessage` | Redux messages; `editingMessageId` / `editingContent` local state | **Fully implemented** | — | Low |
| **Message hover: Delete** | `mychat/.../ChatWindow.jsx` | `handleDeleteMessage` → `transportDeleteMessage` | Redux messages; `deletingMessageIds` local state | **Fully implemented** | Target uses `deleteMessageLocal` (state-only); no transport/API. Behavior unclear from static analysis; depends on backend. | Medium |
| **Report on others’ messages** | `mychat/.../ChatWindow.jsx` (MoreVertical dropdown) | `setShowReportModal(msg.id)` → modal with reasons → toast (no API) | Local `showReportModal` state | **Missing** | No Report button in dropdown for `!isMe`; no Report modal; no report flow | **Medium** |
| **Report user (DM)** | `mychat/.../ChatWindow.jsx` (header Flag) | `setShowReportUserModal(true)` → modal → toast (no API) | Local `showReportUserModal` state | **Missing** | No Flag button in header for DM; no Report User modal | **Medium** |
| **Settings: theme toggle** | `mychat/.../SettingsModal.jsx` | `setTheme("light"|"dark")` | `useSettingsStore` (Zustand persist) | **Fully implemented** | Target uses `useSettings` + `settings.state.js`; equivalent behavior | Low |
| **Settings: other toggles** | `mychat/.../SettingsModal.jsx` | `setTextSize`, `setDensity`, `setReducedMotion`, etc. | `useSettingsStore` | **Fully implemented** | Equivalent | Low |
| **Settings: Export JSON/PDF** | `mychat/.../SettingsModal.jsx` | `handleExportJSON`, `handleExportPDF` | `useMessages` (reference) / `getChatState` (target) | **Fully implemented** | Different data sources; equivalent behavior | Low |
| **Settings: Test notification** | `mychat/.../SettingsModal.jsx` | `handleTestNotification` → `playTestSound` / `Notification` | — | **Fully implemented** | Equivalent | Low |
| **Dark mode application** | `mychat/.../App.jsx` | `root.classList.add(theme)` | `useSettingsStore.theme` | **Fully implemented** | App applies theme; ChatWindow main bg missing `dark:` variant | Medium |
| **Message bubble styling** | `mychat/.../ChatWindow.jsx` | Tailwind: `bg-[#D9FDD3] dark:bg-primary/20`, `bg-white dark:bg-card` | — | **Fully implemented** | Same classes | Low |
| **Chat area background** | `mychat/.../ChatWindow.jsx` | `bg-[#EFEAE2] dark:bg-[#0f172a]` | — | **Partially implemented** | Missing `dark:bg-[#0f172a]` on main container | Low |
| **Flag/metadata indicators** | `mychat/.../ChatWindow.jsx` | Report button in dropdown; no "edited" badge in either app | — | **Partially implemented** | Report option missing; no "edited" indicator in either app | Medium |

---

## Behavioral Traces

### 1. Group Creation (Reference)

```
NewGroupPopup.jsx
  → Step 1: useQuery getUsers → filteredUsers
  → Step 2: groupName, thumbnailPreview, selectedUsers
  → handleCreate() → createGroupMutation.mutate({ name, thumbnailUrl, memberIds })
  → createGroup (api/endpoints) → HTTP POST
  → onSuccess: queryClient.setQueryData(["/api/groups"], [...old, data])
  → setActiveGroupId(data.id), handleClose(), toast
```

### 2. Group Creation (Target)

```
NewGroupPopup.jsx
  → Step 1: PLACEHOLDER_USERS (hardcoded), filtered locally
  → Step 2: groupName; "Upload image" span (no input)
  → Create button: disabled={!groupName.trim()}, no onClick
  → No handleCreate, no API, no state update
  → Sidebar uses MOCK_GROUPS from chatMock.js
```

### 3. Group Thumbnail Upload (Reference)

```
NewGroupPopup.jsx
  → <label><input type="file" onChange={handleThumbnailUpload} />
  → handleThumbnailUpload(e): FileReader.readAsDataURL(file) → setThumbnailPreview(result)
  → thumbnailPreview passed in createGroup payload as thumbnailUrl
```

### 4. Report on Message (Reference)

```
ChatWindow.jsx
  → MoreVertical dropdown, !isMe → <button onClick={() => setShowReportModal(msg.id)}>Report</button>
  → showReportModal truthy → modal with reasons (Spam, Abuse, Harassment, Other)
  → onClick reason → toast("Message reported"), setShowReportModal(null)
  → No API call; UI-only feedback
```

### 5. Report User (Reference)

```
ChatWindow.jsx (DM header)
  → {dmUser && <Button onClick={() => setShowReportUserModal(true)}><Flag /></Button>}
  → showReportUserModal → modal → onClick reason → toast, setShowReportUserModal(false)
  → No API call; UI-only feedback
```

### 6. Message Edit/Delete (Reference)

```
ChatWindow.jsx
  → handleStartEdit(msgId, content) → setEditingMessageId, setEditingContent
  → handleSaveEdit → transportEditMessage(conversationId, msgId, content)
  → handleDeleteMessage → transportDeleteMessage(conversationId, messageId)
  → Transport layer → WebSocket/HTTP; Redux updated via transport responses
```

### 7. Message Edit/Delete (Target)

```
ChatWindow.jsx
  → handleStartEdit → setEditingMessageId, setEditingContent
  → handleSaveEdit → updateMessageContent(conversationId, msgId, content) [chat.state]
  → handleDeleteMessage → deleteMessageLocal(conversationId, messageId) [chat.state]
  → No transport/API calls visible; local state only
```

---

## Hidden Dependencies

| Dependency | Reference | Target | Notes |
|------------|-----------|--------|-------|
| React Query | Used for groups, users | Not used | Target has no groups/users API layer |
| `@/api/endpoints` | `getUsers`, `createGroup`, `getGroups` | Not present | No equivalent in target |
| `queryClient` | `setQueryData` for groups | Not present | — |
| `useChatStore.setActiveGroupId` | Called after group creation | Present | Not called after creation in target |
| `useSettingsStore` / `useSettings` | Theme, density, etc. | Equivalent via `settings.state.js` + `useSettings` | Both persist to localStorage |
| Theme application | App.jsx `root.classList.add(theme)` | Same pattern | Both apply theme to document |
| `reducedMotion` | SettingsModal, report modal `animate-in` | Target SettingsModal has it | ChatWindow may not pass it to modals |

---

## Files Referenced

### Reference (mychat original copy 6)

- `frontend/src/features/chat/NewGroupPopup.jsx` – Group creation, thumbnail
- `frontend/src/features/chat/ChatWindow.jsx` – Message actions, report modals, bubble styling
- `frontend/src/features/chat/Sidebar.jsx` – Groups from React Query
- `frontend/src/features/settings/SettingsModal.jsx` – Settings UI
- `frontend/src/store/settingsStore.js` – Settings state
- `frontend/src/app/App.jsx` – Theme application

### Target (myfrontend)

- `frontend/src/components/chat/NewGroupPopup.jsx` – Group creation (incomplete)
- `frontend/src/components/chat/ChatWindow.jsx` – Message actions, no report
- `frontend/src/components/chat/Sidebar.jsx` – MOCK_GROUPS
- `frontend/src/components/layout/SettingsModal.jsx` – Settings UI
- `frontend/src/state/settings.state.js` – Settings state
- `frontend/src/App.jsx` – Theme application
- `frontend/src/utils/chatMock.js` – MOCK_GROUPS

---

## Verification Pass

- [x] Every feature in scope traced (group creation, thumbnail, message hover edit/delete, report, settings, dark mode, bubble styling, metadata)
- [x] Full behavior chain documented (UI → handler → state → side effects)
- [x] Dependencies documented
- [x] Risk levels assigned with justification
- [x] No feature marked implemented based on UI presence only
