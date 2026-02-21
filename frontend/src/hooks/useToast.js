import * as React from "react";

const TOAST_LIMIT = 1;
/** Delay (ms) before removing a dismissed toast from state. Kept short so X dismiss feels instant; allows exit animation if needed. */
const TOAST_REMOVE_DELAY = 200;

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
};

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

const toastTimeouts = new Map();
/** P6: Auto-dismiss timers by toast id. Cleared when toast is dismissed. */
const toastAutoDismissTimeouts = new Map();

const addToRemoveQueue = (toastId) => {
  if (toastTimeouts.has(toastId)) return;
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({ type: "REMOVE_TOAST", toastId });
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(toastId, timeout);
};

const reducer = (state, action) => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };
    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };
    case "DISMISS_TOAST": {
      const { toastId } = action;
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((t) => addToRemoveQueue(t.id));
      }
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined ? { ...t, open: false } : t
        ),
      };
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) return { ...state, toasts: [] };
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
    default:
      return state;
  }
};

const listeners = [];
let memoryState = { toasts: [] };

function dispatch(action) {
  if (action.type === "DISMISS_TOAST" && action.toastId) {
    const t = toastAutoDismissTimeouts.get(action.toastId);
    if (t) {
      clearTimeout(t);
      toastAutoDismissTimeouts.delete(action.toastId);
    }
  }
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => listener(memoryState));
}

/** Default auto-dismiss when duration not set (ms). */
const DEFAULT_TOAST_DURATION = 5000;

function toast(props) {
  const id = genId();
  const update = (p) => dispatch({ type: "UPDATE_TOAST", toast: { ...p, id } });
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id });
  const duration = props.duration !== undefined ? props.duration : DEFAULT_TOAST_DURATION;
  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      duration,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    const t = setTimeout(() => {
      toastAutoDismissTimeouts.delete(id);
      dispatch({ type: "DISMISS_TOAST", toastId: id });
    }, duration);
    toastAutoDismissTimeouts.set(id, t);
  }
  return { id, dismiss, update };
}

export function useToast() {
  const [state, setState] = React.useState(memoryState);
  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const idx = listeners.indexOf(setState);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }, []);
  return {
    ...state,
    toast,
    dismiss: (toastId) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}

export { toast };
