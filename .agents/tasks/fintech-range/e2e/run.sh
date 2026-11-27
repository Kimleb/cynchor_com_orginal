#!/usr/bin/env bash
# Manual end-to-end run over real HTTP. Usage: PATH=.tools/node22/bin:$PATH bash .agents/tasks/fintech-range/e2e/run.sh
set -u
cd "$(dirname "$0")/../../../.."
export CYNCHOR_DB_PATH=.test.sqlite.e2e IP_HASH_SALT=e2e-salt SESSION_SECRET=e2e-secret-0123456789abcdef0123456789
rm -f .test.sqlite.e2e*
OUT=/tmp/range-e2e; rm -rf $OUT; mkdir -p $OUT
node --import tsx .agents/tasks/fintech-range/e2e/seed.ts
PORT=3457; B=http://127.0.0.1:$PORT
node_modules/.bin/next start -p $PORT > $OUT/server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null $B/api/auth/me && break; sleep 0.5; done
H=(-H 'Content-Type: application/json' -H "Origin: $B")
login() { curl -s -c $OUT/$1.jar "${H[@]}" -X POST $B/api/auth/login -d "{\"email\":\"e2e_$1@e2e.example.test\",\"password\":\"E2e-Passw0rd!\"}" | head -c 80; echo; }
for u in red1 red2 blue1 blue2 spec; do login $u; done
echo "--- logged-out /range/lobby:"; curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' $B/range/lobby
echo "--- queue blue then red"
curl -s -b $OUT/blue1.jar "${H[@]}" -X POST $B/api/range/queue -d '{"teamId":"e2e_team_blue"}'; echo
curl -s -b $OUT/spec.jar $B/api/range/queue; echo
R=$(curl -s -b $OUT/red1.jar "${H[@]}" -X POST $B/api/range/queue -d '{"teamId":"e2e_team_red"}'); echo "$R"
M=$(echo "$R" | sed -E 's/.*"sessionId":"([^"]+)".*/\1/'); echo "match=$M"
curl -s -N -b $OUT/red1.jar "$B/api/range/$M/events" > $OUT/sse_red.txt &
curl -s -N -b $OUT/blue1.jar "$B/api/range/$M/events" > $OUT/sse_blue.txt &
curl -s -N -b $OUT/spec.jar "$B/api/range/$M/events?role=spectator" > $OUT/sse_spec.txt &
sleep 1
echo "--- match page side marker (red1 / blue1 / non-member spec)"
curl -s -b $OUT/red1.jar $B/range/match/$M | grep -o 'Attack console\|Patch console' | sort -u
curl -s -b $OUT/blue1.jar $B/range/match/$M | grep -o 'Attack console\|Patch console' | sort -u
curl -s -o /dev/null -w 'spec on match page: %{http_code} -> %{redirect_url}\n' -b $OUT/spec.jar $B/range/match/$M
curl -s -o /dev/null -w 'spec on spectate page: %{http_code}\n' -b $OUT/spec.jar $B/range/spectate/$M
echo "--- red proxy: wrong side (blue1) then real exploits"
curl -s -b $OUT/blue1.jar "${H[@]}" -X POST $B/api/range/$M/proxy -d '{"method":"GET","path":"/healthz"}'; echo
curl -s -b $OUT/red1.jar "${H[@]}" -X POST $B/api/range/$M/proxy -d '{"method":"GET","path":"/internal/admin/accounts"}' | head -c 200; echo
sleep 7
echo "--- blue patch: closes /internal/admin/accounts"
node -e '
const fs=require("fs");const s=fs.readFileSync("range-target/server.js","utf8");const n="app.get(\x27/internal/admin/accounts\x27, (_req, res) => {";
if(!s.includes(n))throw 1;fs.writeFileSync(process.argv[1],JSON.stringify({file:"server.js",content:s.replace(n,n+" return res.status(403).json({ error: \x27patched\x27 });")}));' $OUT/patch.json
curl -s -b $OUT/blue1.jar "${H[@]}" -X POST $B/api/range/$M/patch --data @$OUT/patch.json; echo
curl -s -b $OUT/red1.jar "${H[@]}" -X POST $B/api/range/$M/patch -d '{"file":"server.js","content":"x"}'; echo
sleep 8
echo "--- red boss sweep"
for i in $(seq 1 15); do curl -s -b $OUT/red2.jar "${H[@]}" -X POST $B/api/range/$M/proxy -d '{"method":"POST","path":"/internal/admin/vault","body":{"toId":3}}' | head -c 150 && break; sleep 1; done; echo
echo "--- wait for end"
for i in $(seq 1 20); do
  C=$(curl -s -o $OUT/report.json -w '%{http_code}' -b $OUT/spec.jar $B/api/range/$M/report); [ "$C" = 200 ] && break; sleep 1; done
echo "report http=$C"; cat $OUT/report.json; echo
curl -s -b $OUT/spec.jar $B/api/range/leaderboard | tee $OUT/leaderboard.json; echo
echo "--- pages after end"
curl -s -o /dev/null -w 'report page %{http_code}\n' -b $OUT/spec.jar $B/range/match/$M/report
curl -s -o /dev/null -w 'leaderboard page %{http_code}\n' -b $OUT/spec.jar $B/range/leaderboard
curl -s -o /dev/null -w 'red1 match page after end: %{http_code} -> %{redirect_url}\n' -b $OUT/red1.jar $B/range/match/$M
echo "--- email leak check (expect 0)"
cat $OUT/report.json $OUT/leaderboard.json | grep -c '@' 
for p in /range/leaderboard /range/match/$M/report /range/spectate/$M; do curl -s -b $OUT/spec.jar $B$p | grep -c 'e2e.example.test'; done
sleep 2
for f in red blue spec; do echo "--- SSE $f: $(grep -c '^event: audit' $OUT/sse_$f.txt) audit, $(grep -c '^event: vault' $OUT/sse_$f.txt) vault, end=$(grep -c '^event: end' $OUT/sse_$f.txt)"; done
grep '^event: vault' -A1 $OUT/sse_spec.txt | grep data | sort -u
echo "--- red SSE actions:"; grep -o '"action":"[A-Z_]*"' $OUT/sse_red.txt | sort | uniq -c
echo "--- spec SSE leaks RED/BLUE-only actions? (expect 0)"; grep -c 'PROXY_REQUEST\|PATCH_APPLIED' $OUT/sse_spec.txt
