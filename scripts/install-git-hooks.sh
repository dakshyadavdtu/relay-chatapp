#!/usr/bin/env bash
# Install git hooks that block commits containing secrets.
# Run from the directory that contains scripts/ (project or repo root):
#   ./scripts/install-git-hooks.sh

set -e
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
HOOK_SRC="$SCRIPT_DIR/pre-commit-secrets.sh"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Not in a git repo."; exit 1; }
HOOK_DEST="$REPO_ROOT/.git/hooks/pre-commit"

if [ ! -f "$HOOK_SRC" ]; then
  echo "Missing hook script: $HOOK_SRC"
  exit 1
fi

cp "$HOOK_SRC" "$HOOK_DEST"
chmod +x "$HOOK_DEST"
echo "Installed pre-commit hook to $HOOK_DEST"
echo "The hook blocks: mongodb+srv:// with credentials, DB_URI= with real values, storage/_data/users.json, private keys, AWS keys."
