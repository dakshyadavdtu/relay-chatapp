# FIX C — Verification (Canonical Chat UI)

## Canonical path

**The canonical chat UI path is `src/features/chat/`.**

- Routes: `/chat` renders the default export of `./features/chat`, which is **ChatRoot** (`src/features/chat/ChatRoot.jsx`).
- ChatRoot loads **Sidebar** and **ChatWindow** from `src/features/chat/ui/`.
- ChatWindow loads **GroupInfoPanel** and **RoomInfoPanel** from `src/features/chat/ui/`.
- No route mounts `pages/chat/ChatPage` or `pages/ChatPlaceholder`.

## Duplicate path

**The duplicate chat path has been quarantined.**

- Former `src/components/chat/` was renamed to **`src/_legacy_components_chat_DO_NOT_USE/`** (Phase C3).
- That folder must never be imported. A README inside it states: legacy duplicate; real chat is `src/features/chat`.
- Placeholder files `pages/ChatPlaceholder.jsx` and `pages/chat/ChatPage.jsx` no longer import `components/chat`; they are quarantined with “DO NOT USE” comments and a stub UI (Phase C2).

## Guard script

**Script:** `scripts/check_no_components_chat_imports.sh`

- **Purpose:** Fails (exit 1) if any file under `src/` imports `components/chat` (scans only `.js`/`.jsx`/`.ts`/`.tsx`, excludes docs).
- **Result after FIX C:** No imports of `components/chat` in source.

Example output:

```
OK: No imports of components/chat in src (js/jsx/ts/tsx, excluding docs).
```

## Runtime proof (canonical chat)

**Procedure used to prove canonical chat at runtime:**

1. Temporary dev-only logs were added in:
   - `src/features/chat/ChatRoot.jsx`
   - `src/features/chat/ui/ChatWindow.jsx`
   - `src/features/chat/ui/GroupInfoPanel.jsx`  
   Each logged: `[CANONICAL_CHAT] <FileName> loaded`.

2. With these in place, `npm run build` was run successfully (canonical files are in the bundle).

3. **Runtime check:** Run `npm run dev`, open the app, go to `/chat`. In the browser console you should see exactly three lines:
   - `[CANONICAL_CHAT] ChatRoot.jsx loaded`
   - `[CANONICAL_CHAT] ChatWindow.jsx loaded`
   - `[CANONICAL_CHAT] GroupInfoPanel.jsx loaded`  
   (GroupInfoPanel loads when the panel is opened; it may appear after opening group info.)

4. Those temporary logs were then **removed** (no permanent debug spam).

**Summary:** The only chat UI loaded when visiting `/chat` is from `src/features/chat/`. The duplicate tree is unused and unimportable.
