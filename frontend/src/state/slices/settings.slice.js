import { createSlice } from "@reduxjs/toolkit";

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

function loadInitialState() {
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

const settingsSlice = createSlice({
  name: "settings",
  initialState: loadInitialState(),
  reducers: {
    setTheme: (state, action) => {
      state.theme = action.payload;
    },
    setTextSize: (state, action) => {
      state.textSize = action.payload;
    },
    setDensity: (state, action) => {
      state.density = action.payload;
    },
    setReducedMotion: (state, action) => {
      state.reducedMotion = action.payload;
    },
    setEnterToSend: (state, action) => {
      state.enterToSend = action.payload;
    },
    setMessageGrouping: (state, action) => {
      state.messageGrouping = action.payload;
    },
    setSoundNotifications: (state, action) => {
      state.soundNotifications = action.payload;
    },
    setDesktopNotifications: (state, action) => {
      state.desktopNotifications = action.payload;
    },
    hydrateFromStorage: (state) => {
      const loaded = loadInitialState();
      Object.assign(state, loaded);
    },
  },
});

function settingsPersistenceMiddleware(store) {
  return (next) => (action) => {
    const result = next(action);
    if (action.type?.startsWith("settings/")) {
      try {
        const settings = store.getState().settings;
        if (settings) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        }
      } catch {
        // ignore
      }
    }
    return result;
  };
}

export const {
  setTheme,
  setTextSize,
  setDensity,
  setReducedMotion,
  setEnterToSend,
  setMessageGrouping,
  setSoundNotifications,
  setDesktopNotifications,
  hydrateFromStorage,
} = settingsSlice.actions;

export { settingsPersistenceMiddleware };
export default settingsSlice.reducer;
