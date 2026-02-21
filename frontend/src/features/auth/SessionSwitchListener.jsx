import { useEffect } from 'react';
import { getAuthState, setAuthState } from '@/state/auth.state';
import { wsClient } from '@/transport/wsClient';
import { subscribeSessionSwitch } from './sessionSwitch';

/**
 * Cookie mode only: listen for storage events. When another tab logs in (auth_user_id_last_seen
 * changes to a different user id), show session-switched and redirect to login.
 */
export function SessionSwitchListener() {
  useEffect(() => {
    const unsub = subscribeSessionSwitch(
      () => getAuthState().user?.id ?? null,
      () => {
        setAuthState({
          sessionSwitched: true,
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
        wsClient.shutdown('session_switched');
        if (typeof window !== 'undefined') {
          window.location.assign('/login?reason=session_switched');
        }
      }
    );
    return unsub;
  }, []);
  return null;
}
