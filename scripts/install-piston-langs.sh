#!/usr/bin/env bash
#
# Install language runtimes into a running Piston instance. For each language
# in $LANGUAGES, query Piston's package index, pick the highest available
# version, and install it. Idempotent — re-running just skips packages that
# are already installed.
#
# Usage:
#   scripts/install-piston-langs.sh [PISTON_URL]
# Default URL: http://localhost:2000

set -euo pipefail

URL="${1:-http://localhost:2000}"

LANGUAGES=(python node typescript java c++)

echo "Target Piston: $URL"
echo "Querying available packages..."
PACKAGES_JSON=$(curl -fsS "$URL/api/v2/packages")
echo

for lang in "${LANGUAGES[@]}"; do
  version=$(jq -r --arg l "$lang" \
    '.[] | select(.language == $l) | .language_version' \
    <<<"$PACKAGES_JSON" | sort -V | tail -1)

  if [ -z "$version" ]; then
    printf "%-12s %-10s SKIP — no version available in package index\n" "$lang" "-"
    continue
  fi

  printf "%-12s %-10s ... " "$lang" "$version"
  body=$(jq -nc --arg l "$lang" --arg v "$version" '{language:$l, version:$v}')
  http_status=$(curl -sS -o /tmp/piston-install.out -w "%{http_code}" \
    -X POST "$URL/api/v2/packages" \
    -H "Content-Type: application/json" \
    -d "$body" || echo "000")
  case "$http_status" in
    200) echo "installed" ;;
    400)
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
