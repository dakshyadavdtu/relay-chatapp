/**
 * Phase 3: Stub auth for chat UI. Returns mock user; logout no-op.
 */
import { MOCK_CURRENT_USER } from "./mockChatState.js";

export function useAuth() {
  return {
    user: MOCK_CURRENT_USER,
    logout: () => {},
    isAuthenticated: true,
    isLoading: false,
  };
}
