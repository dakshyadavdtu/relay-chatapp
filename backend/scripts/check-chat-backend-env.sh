#!/usr/bin/env bash
# Tier-1.6 — Env check for systemd ExecStartPre.
# systemd MUST refuse to start if env file or any required var is missing.
# Exit 0 = ok; exit 1 = fail (systemd will not start the service).

set -e
ENV_FILE="${ENV_FILE:-/etc/chat-backend.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

# Source and check required vars (no silent defaults)
# shellcheck source=/dev/null
source "$ENV_FILE"

REQUIRED="NODE_ENV PORT JWT_SECRET DB_URI COOKIE_DOMAIN WS_PATH"
for var in $REQUIRED; do
  val="${!var}"
  if [ -z "$val" ] || [ "$val" = "" ]; then
    echo "Missing or empty required variable: $var" >&2
    exit 1
  fi
done
# At least one of CORS_ORIGIN or CORS_ORIGINS must be set
if { [ -z "${CORS_ORIGIN}" ] || [ "$CORS_ORIGIN" = "" ]; } && { [ -z "${CORS_ORIGINS}" ] || [ "$CORS_ORIGINS" = "" ]; }; then
  echo "Missing or empty: at least one of CORS_ORIGIN or CORS_ORIGINS must be set" >&2
  exit 1
fi

# Production must have NODE_ENV=production
if [ "$NODE_ENV" != "production" ]; then
  echo "NODE_ENV must be production in this service" >&2
  exit 1
fi

exit 0
