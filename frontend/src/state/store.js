import { configureStore } from "@reduxjs/toolkit";

/**
 * Phase 7B: Settings moved to ui_prefs boundary.
 * Redux store kept minimal for any future reducers.
 */
export const store = configureStore({
  reducer: {
    _placeholder: (state = {}, _action) => state,
  },
});
