/**
 * Settings state. Subscribable, persisted to localStorage.
 * @legacy Phase 3.5: Replaced by Redux slice (settings.slice.js). Kept for compatibility.
 */

const STORAGE_KEY = "chat-settings";

const defaults = {
  theme: "light",
  textSize: "medium",
  density: "comfortable",
  reducedMotion: false,
  enterToSend: true,
  messageGrouping: true,
  soundNotifications: true,
  desktopNotifications: false,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...defaults };
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

let state = load();
const listeners = new Set();

export function getSettingsState() {
  return { ...state };
}

export function setSettingsState(update) {
  state = { ...state, ...update };
  save(state);
  listeners.forEach((fn) => fn());
}

export function subscribeSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
