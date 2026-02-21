/**
 * Subscription manager. Component-scoped WebSocket subscriptions for safe cleanup.
 */
import { subscribe as coreSubscribe } from "@/websocket/connection/core";

const componentSubscriptions = new Map();
let refIdCounter = 0;

function generateRefId() {
  return `ws_${++refIdCounter}_${Date.now()}`;
}

export function subscribe(eventName, handler, componentRefId = null) {
  const refId = componentRefId || generateRefId();
  const unsubscribe = coreSubscribe(eventName, handler);
  if (!componentSubscriptions.has(refId)) {
    componentSubscriptions.set(refId, new Map());
  }
  const componentSubs = componentSubscriptions.get(refId);
  if (!componentSubs.has(eventName)) {
    componentSubs.set(eventName, new Set());
  }
  componentSubs.get(eventName).add(unsubscribe);
  return () => {
    unsubscribe();
    const subs = componentSubscriptions.get(refId);
    if (subs) {
      const eventSubs = subs.get(eventName);
      if (eventSubs) {
        eventSubs.delete(unsubscribe);
        if (eventSubs.size === 0) subs.delete(eventName);
      }
      if (subs.size === 0) componentSubscriptions.delete(refId);
    }
  };
}

export function unsubscribeAllForComponent(componentRefId) {
  const componentSubs = componentSubscriptions.get(componentRefId);
  if (!componentSubs) return;
  componentSubs.forEach((unsubscribeSet) => {
    unsubscribeSet.forEach((unsubscribe) => unsubscribe());
  });
  componentSubscriptions.delete(componentRefId);
}
