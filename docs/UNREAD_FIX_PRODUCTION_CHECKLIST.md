# Unread fix — production verification checklist

Use this checklist to confirm unread/cursor behavior in production (slow network or throttling recommended for step 1).

---

## 1. Open DM before history loads

- [ ] With **slow network** (throttle in DevTools or use slow 3G), log in and **click a DM immediately** (before history loads).
- **Expected:** Unread clears and **stays cleared** after history appears (no badge reappearing).

---

## 2. Refresh after opening a chat

- [ ] Open a DM so unread is 0, then **refresh the page**.
- **Expected:** Unread **remains cleared** (server cursor was updated; GET /api/chats returns 0).

---

## 3. New DM while chat is open

- [ ] Have a DM open (unread 0). From another device/session, **send a new message** to that chat.
- **Expected:** Unread **does not increase**; stays 0 even after **switching tabs away and back**.

---

## 4. New DM while chat is closed

- [ ] **Close** the DM (select another chat or leave chat open elsewhere). From another device/session, **send a new message** to that DM.
- **Expected:** Unread **increases** (badge shows). Opening that chat **clears** unread and **persists** (stays 0 after refresh/tab switch).

---

## 5. Tab switch — no resurrection

- [ ] Open one or more DMs so their unread is 0. **Switch tabs away and back** multiple times (or trigger visibility change).
- **Expected:** Unread **does not “come back”** for already-seen chats (loadChats does not overwrite with stale API count).

---

## Quick reference

| Scenario                    | Expected result                          |
|----------------------------|------------------------------------------|
| Open DM before history     | Unread clears and stays 0 when history loads |
| Refresh after opening      | Unread stays 0 (cursor persisted)        |
| New message, chat open     | Unread stays 0; no bump on tab switch   |
| New message, chat closed   | Unread increases; opening clears & persists |
| Tab switch (seen chats)    | Unread does not reappear                |
