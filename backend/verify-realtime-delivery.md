# Realtime Delivery Verification Guide

## Prerequisites
- Backend MongoDB deliveries collection has been cleaned (0 documents)
- `persistMessage()` no longer creates delivery records at message creation

## Step 1: Restart Backend

```bash
cd backend
# Stop any running backend process (Ctrl+C or kill process)
PORT=8000 node server.js
# Or: npm run dev:proxy
```

**Note:** This instrumentation was removed. Debug mode flags (WS_DEBUG_MODE, PresenceTrace, WS_CONN_TRACE) are no longer available.

Expected: Backend starts successfully, no errors about MongoDB connection.

## Step 2: Open Two Browser Sessions

### Session A (User A):
1. Open browser (or incognito window)
2. Navigate to frontend (typically http://localhost:5173)
3. Login as User A
4. Open DevTools Console (F12)
5. Keep console visible

### Session B (User B):
1. Open another browser window (or incognito)
2. Navigate to frontend (same URL)
3. Login as User B
4. Open DevTools Console (F12)
5. Select DM conversation with User A from sidebar

## Step 3: Send Message A -> B

In Session A:
1. Select DM conversation with User B
2. Type a test message: "Test realtime delivery"
3. Send the message

## Step 4: Verify Backend / UI

**Note:** That instrumentation no longer exists; rely on UI and normal server logs.

### ✅ PASS CONDITIONS (Must see these):

**Backend:** Starts and runs without errors; no requirement for specific debug log lines.

**Backend console should NOT show (if it did, would indicate bug):**
```
[Phase1] attemptDelivery early-return ... alreadyDelivered: true
```

### ✅ PASS CONDITIONS (User B side):

**Session B should:**
- Receive message instantly without page refresh
- See message appear in chat window immediately
- Console should show `[WS_MERGE]` and `[UI_READ]` logs (from Phase A4)

## Step 5: If Still Failing - Debug Search

If you see `alreadyDelivered: true` or message doesn't arrive:

### Search backend logs for:
```bash
# In backend console, look for:
grep -i "attemptDelivery" 
grep -i "alreadyDelivered"
grep -i "isMessageDelivered"
grep -i "deliveries"
```

### Check MongoDB directly:
Use your MongoDB connection string from env (never commit real URIs). Example:
```bash
# Set DB_URI in env or export it, then:
mongosh "$DB_URI" --eval "db.deliveries.find({}).limit(5)"
```
Placeholder form: `mongodb+srv://<USER>:<PASSWORD>@<HOST>/<DB>?<OPTIONS>`

Should return empty or only NEW delivery records created AFTER message was sent (not at creation time).

### Check if persistMessage is still creating deliveries:
```bash
# Search backend codebase for any remaining delivery inserts in persistMessage
grep -r "deliveries.*insertOne\|deliveries.*updateOne" backend/storage/
```

Should only find `markMessageDelivered()` function, NOT in `persistMessage()`.

## Expected Flow (Correct Behavior):

1. **Message Creation:**
   - `persistMessage()` creates message in `messages` collection
   - NO delivery record created yet ✓

2. **Delivery Attempt:**
   - `attemptDelivery()` calls `isDeliveredTo()`
   - `isDeliveredTo()` queries `deliveries` collection
   - Returns `false` (no record exists) ✓
   - Proceeds to send via WebSocket ✓

3. **WebSocket Delivery:**
   - Message sent to User B's socket(s)
   - User B receives `MESSAGE_RECEIVE` event
   - Frontend merges message into state
   - UI updates immediately ✓

4. **Delivery Confirmation:**
   - After successful WS send, `markMessageDelivered()` creates delivery record
   - Future attempts will see `alreadyDelivered: true` (correct behavior)

## Troubleshooting

### Issue: Still seeing `alreadyDelivered: true`
- **Check:** MongoDB deliveries collection may have been repopulated
- **Fix:** Run cleanup again: `db.deliveries.deleteMany({})`
- **Check:** Verify `persistMessage()` doesn't create deliveries (code review)

### Issue: Message not arriving
- **Check:** User B's WebSocket connection status
- **Check:** Backend logs show `socketCount: 0` → User B not connected
- **Check:** Backend logs show errors → Check connection manager

### Issue: Message arrives but late
- **Check:** Backend logs timing
- **Check:** Network latency
- **Check:** WebSocket reconnection issues
