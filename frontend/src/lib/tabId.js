/**
 * Per-tab instance ID for DEV instrumentation (multitab debugging).
 * Stored in sessionStorage so each tab has its own ID; refresh keeps same tab ID.
 */

const KEY = 'ws_tab_instance_id';

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @returns {string} Stable ID for this tab (same for the lifetime of the tab).
 */
export function getTabInstanceId() {
  if (typeof sessionStorage === 'undefined') return 'ssr';
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = randomId();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

export const TAB_INSTANCE_ID = typeof sessionStorage !== 'undefined' ? getTabInstanceId() : 'ssr';
