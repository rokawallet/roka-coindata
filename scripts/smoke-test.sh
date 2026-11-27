#!/usr/bin/env bash
# Post-deploy smoke test against a live deployment (uses real providers; consumes a little quota).
# Usage: BASE_URL=https://your-app.vercel.app [API_KEY=rcd_...] ./scripts/smoke-test.sh
set -euo pipefail
BASE_URL="${BASE_URL:?set BASE_URL}"
auth=(); [ -n "${API_KEY:-}" ] && auth=(-H "Authorization: Bearer $API_KEY")
echo "health";            curl -s "$BASE_URL/health"; echo
echo "chains";            curl -s "$BASE_URL/api/v1/chains" | head -c 300; echo
echo "USDC on Ethereum";  curl -s "$BASE_URL/api/v1/coins/1/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" | head -c 600; echo
echo "native ETH";        curl -s "$BASE_URL/api/v1/coins/native/1" | head -c 300; echo
echo "search";            curl -s "$BASE_URL/api/v1/search?q=usdc" | head -c 300; echo
echo "bad address (expect 400)"; curl -s -o /dev/null -w '%{http_code}\n' "$BASE_URL/api/v1/coins/1/0x123"
echo "admin without key (expect 401)"; curl -s -o /dev/null -w '%{http_code}\n' "$BASE_URL/api/v1/admin/jobs"
