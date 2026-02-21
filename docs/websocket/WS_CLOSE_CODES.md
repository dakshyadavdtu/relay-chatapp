# WebSocket close codes and semantics

## Goal

Correct WS close semantics so auth-related shutdown does not look like a normal close, and the client does not attempt endless reconnect on session expiry or logout.

## Codes used

| Code | Name / usage | Who sends | Client behavior |
|------|----------------|-----------|------------------|
| **1000** | NORMAL | Client `shutdown(reason)` when reason is not auth-related | Treat as normal close; may reconnect if other conditions allow. |
| **4001** | UNAUTHORIZED | Client `shutdown('session_expired')` or `shutdown('logout')`; server auth failure | Do NOT reconnect; route to login (reconnectDisabled, WS_AUTH_FAILED). |
| **4401 / 4403** | Custom auth | Server (optional) | Same as 4001: no reconnect, treat as auth. |
| **1008** | POLICY_VIOLATION | Server (e.g. "Not authenticated") | No reconnect, auth. |
| **4005** | SESSION_INVALID | Server (rehydration failed, etc.) | No reconnect, auth. |
| **4003** | Account suspended/ban | Server | No reconnect; emit WS_ACCOUNT_SUSPENDED. |

## Rationale

- **4001** for session_expired/logout: Standard application-level code for "unauthorized"; server and client can both treat it as auth failure and avoid reconnect loops.
- **Reason string ≤123 bytes**: RFC 6455 limit; client uses `truncateCloseReason()` before `ws.close(code, reason)`.

## Backwards compatibility

- If the client still sends **code 1000** with **reason "session_expired"** or **"logout"** (e.g. old build), the frontend **onclose** still treats it as auth: `(code === 1000 && (isSessionExpiredReason || isLogoutReason))` → `isAuthClose` true → no reconnect, emit WS_AUTH_FAILED.

## Server logging

- **Server close logging:** This instrumentation was removed. Debug mode flags (WS_CONN_TRACE, etc.) are no longer available. Use normal server logs; close events include `closeCode` and `reason` (decoded safely, capped for log size).
