/**
 * Optional agent/debug telemetry. Off by default to avoid net::ERR_INSUFFICIENT_RESOURCES.
 * Enable with VITE_AGENT_LOG=1 in .env (and DEV) for local debugging only.
 * Throttled to at most 1 request per second.
 */

const INGEST_URL = "http://127.0.0.1:7243/ingest/ad41c2e3-82ca-4e49-af5c-38aa66637bca";
let lastSentTs = 0;

/**
 * @param {Object} payload - { location, message, data?, timestamp?, ... }
 */
export function agentLog(payload) {
  if (import.meta.env.DEV !== true || import.meta.env.VITE_AGENT_LOG !== "1") return;
  const now = Date.now();
  if (now - lastSentTs < 1000) return;
  lastSentTs = now;
  const body = typeof payload === "object" && payload !== null ? { ...payload, timestamp: payload.timestamp ?? now } : { timestamp: now };
  fetch(INGEST_URL, {
    method: "POST",
    credentials: "omit", // External ingest; do not send app cookies
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}
