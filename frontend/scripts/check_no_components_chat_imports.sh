#!/usr/bin/env bash
# Phase C1 guard: fail if any file under src/ imports components/chat.
# Scans only .js/.jsx/.ts/.tsx; ignores docs and markdown.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/src"
cd "$ROOT"
HITS=""
for ext in js jsx ts tsx; do
  while IFS= read -r -d '' f; do
    # Skip files under docs (and similar doc paths)
    if [[ "$f" == *"/docs/"* ]]; then continue; fi
    if grep -q -E "@/components/chat|from ['\"][^'\"]*components/chat|require\s*\(['\"][^'\"]*components/chat" "$f" 2>/dev/null; then
      HITS="${HITS}${f}"$'\n'
    fi
  done < <(find "$SRC" -type f -name "*.${ext}" -print0 2>/dev/null)
done
if [[ -n "$HITS" ]]; then
  echo "FAIL: The following files import src/components/chat:"
  echo "$HITS"
  exit 1
fi
echo "OK: No imports of components/chat in src (js/jsx/ts/tsx, excluding docs)."
exit 0
