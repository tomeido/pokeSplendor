#!/usr/bin/env bash
set -uo pipefail
cd /app
echo "::: npm ci :::"
npm ci --no-audit --no-fund 2>&1 | tail -5 || { echo "NPM_CI_FAILED"; exit 10; }

echo
echo "::: typecheck (tsc --noEmit) :::"
if npm run -s typecheck; then echo "TYPECHECK_OK"; else echo "TYPECHECK_FAILED"; FAIL=1; fi

echo
echo "::: unit/integration tests :::"
TEST_FAIL=0
for f in server/*.test.ts; do
  echo "--- $f ---"
  if npx tsx "$f"; then echo "PASS $f"; else echo "FAIL $f"; TEST_FAIL=1; fi
done
[ "$TEST_FAIL" = 1 ] && FAIL=1

echo
echo "::: production build (BASE_PATH=/splendor) :::"
if BASE_PATH=/splendor npm run -s build 2>&1 | tail -15; then echo "BUILD_OK"; else echo "BUILD_FAILED"; FAIL=1; fi

echo
echo "::: verify change present in build output :::"
if grep -rq "mc-cost\|mc-pip" dist/assets/ 2>/dev/null; then echo "CHANGE_IN_BUNDLE_OK"; else echo "CHANGE_IN_BUNDLE_MISSING"; FAIL=1; fi

echo
echo "==================================="
if [ "${FAIL:-0}" = 1 ]; then echo "OVERALL: FAILED"; exit 1; else echo "OVERALL: ALL_GREEN"; fi
