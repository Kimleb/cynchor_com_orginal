#!/usr/bin/env bash
# Usage: bash .agents/tasks/range-fixes/e2e/run-browser.sh  (requires a built .next; never run while `npm run dev` runs)
set -u
cd "$(dirname "$0")/../../../.."
export PATH=$PWD/.tools/node22/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=$PWD/.tools/pw
export CYNCHOR_DB_PATH=.test.sqlite.e2eb IP_HASH_SALT=e2e-salt SESSION_SECRET=e2e-secret-0123456789abcdef0123456789
rm -f .test.sqlite.e2eb*
node --import tsx .agents/tasks/fintech-range/e2e/seed.ts
PORT=3458
node_modules/.bin/next start -p $PORT > /tmp/range-browser-server.log 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:$PORT/api/auth/me && break; sleep 0.5; done
B=http://127.0.0.1:$PORT node .agents/tasks/range-fixes/e2e/browser.mjs 2>&1 | tee .agents/tasks/range-fixes/e2e/browser.log
RC=${PIPESTATUS[0]}
exit $RC
