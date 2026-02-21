/**
 * Message domain helpers (from mychat source). No date-fns; plain JS.
 */

function isToday(d) {
  const today = new Date();
  return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
}
function isYesterday(d) {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return d.getDate() === y.getDate() && d.getMonth() === y.getMonth() && d.getFullYear() === y.getFullYear();
}
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shouldGroupWithPrev(message, prevMessage, groupingThreshold = 5 * 60 * 1000) {
  if (!prevMessage || message.senderId !== prevMessage.senderId) return false;
  const msgTime = message.timestamp || (message.createdAt ? new Date(message.createdAt).getTime() : 0);
  const prevTime = prevMessage.timestamp || (prevMessage.createdAt ? new Date(prevMessage.createdAt).getTime() : 0);
  return Math.abs(msgTime - prevTime) < groupingThreshold;
}

export function formatTimestamp(timestamp, _formatStr = "h:mm a") {
  if (!timestamp) return "";
  try {
    const ts = typeof timestamp === "number" ? new Date(timestamp) : typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    if (Number.isNaN(ts.getTime())) return "";
    return ts.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
}

export function getDaySeparator(date, prevDate) {
  if (!date) return null;
  try {
    const msgDate = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(msgDate.getTime())) return null;
    if (!prevDate) {
      if (isToday(msgDate)) return "Today";
      if (isYesterday(msgDate)) return "Yesterday";
      return msgDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }
    const prevMsgDate = prevDate instanceof Date ? prevDate : new Date(prevDate);
    if (Number.isNaN(prevMsgDate.getTime())) {
      if (isToday(msgDate)) return "Today";
      if (isYesterday(msgDate)) return "Yesterday";
      return msgDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }
    if (dateKey(msgDate) !== dateKey(prevMsgDate)) {
      if (isToday(msgDate)) return "Today";
      if (isYesterday(msgDate)) return "Yesterday";
      return msgDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }
    return null;
  } catch {
    return null;
  }
}

export function getStatusIconConfig(status, isMe) {
  if (!isMe) return null;
  switch (status) {
    case "sending":
    case "queued":
      return { type: "spinner", className: "w-3 h-3 animate-spin" };
    case "sent":
      return { type: "check", className: "w-3 h-3" };
    case "delivered":
    case "read":
      return { type: "check-check", className: "w-3 h-3 text-blue-500" };
    case "failed":
      return { type: "alert-circle", className: "w-3 h-3 text-destructive" };
    default:
      return { type: "check", className: "w-3 h-3" };
  }
}
