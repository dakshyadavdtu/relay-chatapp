#!/usr/bin/env bash
# Pre-commit hook: block commits that contain secrets or sensitive paths.
# Install with: ./scripts/install-git-hooks.sh (run from repo root)

set -e
STAGED_PATHS=$(git diff --cached --name-only 2>/dev/null || true)
STAGED_PATCH=$(git diff --cached 2>/dev/null || true)

err=0

# Block sensitive paths
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *storage/_data/users.json*|*storage/_data/*.json)
      echo "pre-commit: BLOCKED — sensitive path: $f"
      err=1
      ;;
    *.pem|*.key|*.p12)
      echo "pre-commit: BLOCKED — key/cert file: $f"
      err=1
      ;;
  esac
done <<EOF
$STAGED_PATHS
EOF

# Block private keys in staged content
if echo "$STAGED_PATCH" | grep -qE '^\+.*BEGIN (RSA )?PRIVATE KEY'; then
  echo "pre-commit: BLOCKED — private key content detected in staged diff"
  err=1
fi

# Block MongoDB URIs with real-looking credentials (allow placeholders <USER>, <PASSWORD>, <HOST>, <DB>)
URIS=$(echo "$STAGED_PATCH" | grep -E '^\+' | grep -v '^\+\+\+' | grep 'mongodb+srv://' || true)
if [ -n "$URIS" ]; then
  if echo "$URIS" | grep -vqE '<USER>|<PASSWORD>|<HOST>|<DB>'; then
    echo "pre-commit: BLOCKED — possible MongoDB URI with credentials. Use DB_URI from env only. See docs/SECRETS_POLICY.md"
    err=1
  fi
fi

# Block DB_URI= with real-looking value (contains @ and mongodb, not placeholder)
DBURI_LINES=$(echo "$STAGED_PATCH" | grep -E '^\+' | grep -v '^\+\+\+' | grep 'DB_URI=.*@.*mongodb' || true)
if [ -n "$DBURI_LINES" ]; then
  if echo "$DBURI_LINES" | grep -vqE '<USER>|<PASSWORD>|<HOST>'; then
    echo "pre-commit: BLOCKED — DB_URI appears to contain real credentials"
    err=1
  fi
fi

# Block AWS key pattern
if echo "$STAGED_PATCH" | grep -E '^\+' | grep -v '^\+\+\+' | grep -qE 'AKIA[0-9A-Z]{16}'; then
  echo "pre-commit: BLOCKED — possible AWS key detected"
  err=1
fi

[ $err -eq 0 ] || exit 1
exit 0
