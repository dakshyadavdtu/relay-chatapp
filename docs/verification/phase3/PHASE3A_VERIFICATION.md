# Phase 3A DM Protocol – Verification Steps

## Manual verification

### 1. Message types handled
- **HELLO_ACK**: Log in, open /chat. Console should log `[ws] connected`.
- **MESSAGE_ACK**: Send a DM. Optimistic message should change to persisted (check icon).
- **MESSAGE_RECEIVE**: User A sends, User B sees message in real time.
- **MESSAGE_ERROR / ERROR**: Trigger backend rejection (see below).
- **RATE_LIMIT_WARNING**: Send >80% of rate limit in 1 min; toast should appear.
- **MESSAGE_REPLAY_COMPLETE**: Backend sends after replay; no crash.
- **PONG**: Sent every 30s when connected; backend responds; no crash.

### 2. Outgoing types
- **HELLO**: Sent on connect (auto).
- **MESSAGE_SEND**: Sent when user sends DM (via Send).
- **CLIENT_ACK**: Sent when MESSAGE_RECEIVE is received (auto).
- **PING**: Sent every 30s when connected (auto).

### 3. Backend error tests
| Test | How | Expected UI |
|------|-----|-------------|
| Empty content | Send empty (trim) | Send disabled when empty |
| Content >10k | Paste 10,001 chars | Toast: "Message too long" |
| Rate limit | Send 100+ msgs in 1 min | Toast: "Rate limit" or "Message failed" |

### 4. Two-browser test
1. Log in as userA in browser 1.
2. Log in as userB in browser 2 (incognito or different profile).
3. UserA opens DM with userB, sends message.
4. UserB should see the message in real time without refresh.

## Log locations
- `[ws] connected` – wsClient.js on HELLO_ACK
- `[wsClient] handleMessage error` – subscriber handler error
- All WS messages flow via wsClient.subscribe → ChatAdapterContext.handleMessage
