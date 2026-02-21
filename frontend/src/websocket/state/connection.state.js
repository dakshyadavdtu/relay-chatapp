/**
 * WebSocket connection state. Subscribable, no Redux.
 */
let state = {
  status: "disconnected", // disconnected | connecting | connected | reconnecting
};

const listeners = new Set();

export function getConnectionState() {
  return { ...state };
}

export function setConnectionState(update) {
  state = { ...state, ...update };
  listeners.forEach((fn) => fn());
}

export function subscribeConnection(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
