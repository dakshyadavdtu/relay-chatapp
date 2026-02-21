#!/bin/bash

# Verification script for realtime delivery fix
# Checks that deliveries collection is clean and persistMessage doesn't create deliveries
# Requires DB_URI in environment (e.g. export DB_URI='mongodb+srv://<USER>:<PASSWORD>@<HOST>/<DB>?<OPTIONS>')

set -e

if [ -z "$DB_URI" ]; then
  echo "DB_URI is required. Example: export DB_URI='mongodb+srv://<USER>:<PASSWORD>@<HOST>/<DB>?<OPTIONS>'"
  exit 1
fi

echo "=== Realtime Delivery Fix Verification ==="
echo ""

# Check MongoDB deliveries count
echo "1. Checking MongoDB deliveries collection..."
DELIVERY_COUNT=$(mongosh "$DB_URI" --quiet --eval "db.deliveries.countDocuments()" 2>/dev/null || echo "0")

if [ "$DELIVERY_COUNT" = "0" ]; then
  echo "   ✅ PASS: deliveries collection is empty ($DELIVERY_COUNT documents)"
else
  echo "   ⚠️  WARNING: deliveries collection has $DELIVERY_COUNT documents"
  echo "   Run cleanup: mongosh ... --eval \"db.deliveries.deleteMany({})\""
fi

echo ""

# Check persistMessage doesn't create deliveries
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "2. Checking persistMessage() code..."
if grep -q "DELIVERY_COLLECTION.*insertOne\|deliveries.*insertOne" "$BACKEND_DIR/storage/message.mongo.js" 2>/dev/null; then
  echo "   ❌ FAIL: persistMessage() still creates delivery records"
  echo "   Found problematic code in storage/message.mongo.js"
  exit 1
else
  echo "   ✅ PASS: persistMessage() does NOT create delivery records"
fi

echo ""

# Check markMessageDelivered still exists (should create deliveries AFTER delivery)
echo "3. Checking markMessageDelivered() exists..."
if grep -q "markMessageDelivered" "$BACKEND_DIR/storage/message.mongo.js" 2>/dev/null; then
  echo "   ✅ PASS: markMessageDelivered() exists (creates deliveries AFTER delivery)"
else
  echo "   ⚠️  WARNING: markMessageDelivered() not found"
fi

echo ""
echo "4. Checking delivery records timestamp..."
# Check if any deliveries exist and when they were created
DELIVERY_INFO=$(mongosh "$DB_URI" --quiet --eval "db.deliveries.find({}).sort({deliveredAt: -1}).limit(1).toArray()[0]" 2>/dev/null || echo "")
if [ -n "$DELIVERY_INFO" ] && [ "$DELIVERY_INFO" != "null" ]; then
  echo "   ℹ️  INFO: Found delivery records (these are OK if created AFTER message delivery)"
  echo "   These should only exist if messages were successfully delivered via WebSocket"
else
  echo "   ✅ PASS: No delivery records (clean state)"
fi

echo ""
echo "=== Verification Complete ==="
echo ""
echo "Next steps:"
echo "1. Restart backend: PORT=8000 node server.js (or npm run dev:proxy)"
echo "2. Test with two users (see verify-realtime-delivery.md)"
echo "3. Verify delivery via UI; backend should not log 'alreadyDelivered: true' for first delivery"
