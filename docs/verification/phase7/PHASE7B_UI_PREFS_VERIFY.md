# Phase 7B — Settings affect chat: sanity check

Manual steps to confirm theme, text size, density, and reduced motion apply globally (settings pages + chat UI).

---

## 1. Toggle theme → chat background/foreground changes

1. Open the app and go to **Chat** (or open Settings modal from chat header).
2. Open **Settings** (gear) or go to **Preferences** (`/settings/preferences`).
3. Change **Theme** between **Light** and **Dark**.
4. **Expected:** Chat area background and text, sidebar, message bubbles, and the rest of the app switch to match the selected theme.

---

## 2. Toggle compact → message list spacing changes

1. In Settings / Preferences, set **Density** to **Comfortable**, then to **Compact**.
2. **Expected:**
   - **Comfortable:** More space between messages, larger padding in message bubbles, sidebar items, and chat header.
   - **Compact:** Tighter gaps between messages, smaller padding in bubbles, sidebar, and header.

---

## 3. Toggle text size → message text size changes

1. In Settings / Preferences, change **Text size** (e.g. Small → Medium → Large).
2. **Expected:** Message text and general app typography scale up/down (e.g. Small ≈ 14px, Medium ≈ 16px, Large ≈ 18px at root).

---

## 4. Toggle reduced motion → transitions disabled (optional)

1. Enable **Reduced motion** in Settings / Preferences.
2. **Expected:** Animations and transitions are effectively disabled (e.g. scroll is instant, no fade/slide duration). Disable the toggle to restore normal motion.

---

## Notes

- Preferences are applied to the document root (e.g. `html`) via `ui_prefs.apply`; CSS uses root classes (`.text-small`, `.density-compact`, `.reduced-motion`) and variables (`--base-font-size`, `--ui-gap`, `--ui-pad`, etc.).
- Chat uses `.chat-header`, `.msg-list`, `.msg-bubble`, `.chat-root-pad`, and sidebar uses `.sidebar-item`, `.sidebar-pad` so density and layout respond to these vars.
