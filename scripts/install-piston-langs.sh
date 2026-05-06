#!/usr/bin/env bash
#
# Install language runtimes into a running Piston instance.
# Idempotent: re-running with already-installed versions is a noop.
#
# Usage:
#   scripts/install-piston-langs.sh [PISTON_URL]
# Default URL: http://localhost:2000

set -euo pipefail

URL="${1:-http://localhost:2000}"

# Pinned versions known to be available in the Piston package index. Bump
# explicitly when you want a newer compiler/interpreter.
LANGS=(
  "python:3.10.0"
  "node:18.15.0"
  "typescript:5.0.3"
  "java:15.0.2"
  "c++:10.2.0"
)

echo "Target Piston: $URL"
echo

for entry in "${LANGS[@]}"; do
  lang="${entry%:*}"
  version="${entry#*:}"
  printf "%-12s %-8s ... " "$lang" "$version"
  body=$(jq -nc --arg l "$lang" --arg v "$version" '{language:$l, version:$v}')
  http_status=$(curl -sS -o /tmp/piston-install.out -w "%{http_code}" \
    -X POST "$URL/api/v2/packages" \
    -H "Content-Type: application/json" \
    -d "$body" || echo "000")
  case "$http_status" in
    200) echo "installed" ;;
    400)
      # Already installed surfaces as 400 with a specific message.
      if grep -q "already installed" /tmp/piston-install.out 2>/dev/null; then
        echo "already installed"
      else
        echo "FAILED ($(cat /tmp/piston-install.out))"
      fi
      ;;
    *) echo "FAILED status=$http_status body=$(cat /tmp/piston-install.out)" ;;
  esac
done

echo
echo "Currently installed runtimes:"
curl -fsS "$URL/api/v2/runtimes" | jq -r '.[] | "  \(.language)@\(.version)"'
