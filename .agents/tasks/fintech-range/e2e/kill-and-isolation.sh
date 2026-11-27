#!/usr/bin/env bash
# FEAT-005: live match -> hardening/isolation probes via the docker CLI -> kill switch as non-operator (403) then operator.
set -u
cd "$(dirname "$0")/../../../.."
export CYNCHOR_DB_PATH=.test.sqlite.e2e IP_HASH_SALT=e2e-salt SESSION_SECRET=e2e-secret-0123456789abcdef0123456789
rm -f .test.sqlite.e2e*
OUT=/tmp/range-e2e2; rm -rf $OUT; mkdir -p $OUT
node --import tsx .agents/tasks/fintech-range/e2e/seed.ts
node --import tsx -e "import('./src/lib/db').then(m=>{m.getDb().prepare(\"INSERT OR REPLACE INTO users (id,email,password_hash,name,role,experience_level,is_profile_completed,is_operator,created_at) VALUES ('e2e_op','e2e_op@e2e.example.test',?, 'OpUser','GRC','EXPERT',1,1,?)\").run(m.hashPassword('E2e-Passw0rd!'),new Date().toISOString())})"
PORT=3458; B=http://127.0.0.1:$PORT
node_modules/.bin/next start -p $PORT > $OUT/server.log 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null $B/api/auth/me && break; sleep 0.5; done
H=(-H 'Content-Type: application/json' -H "Origin: $B")
for u in red1 blue1 op; do curl -s -c $OUT/$u.jar "${H[@]}" -X POST $B/api/auth/login -d "{\"email\":\"e2e_$u@e2e.example.test\",\"password\":\"E2e-Passw0rd!\"}" >/dev/null; done
curl -s -b $OUT/blue1.jar "${H[@]}" -X POST $B/api/range/queue -d '{"teamId":"e2e_team_blue"}' >/dev/null
R=$(curl -s -b $OUT/red1.jar "${H[@]}" -X POST $B/api/range/queue -d '{"teamId":"e2e_team_red"}'); echo "$R"
M=$(echo "$R" | sed -E 's/.*"sessionId":"([^"]+)".*/\1/')
echo "--- docker resources for the match"
docker ps --filter label=cynchor.range --format '{{.Names}} {{.Status}} ports=[{{.Ports}}]'
docker network ls --filter label=cynchor.range --format '{{.Name}} {{.Driver}}'
C=$(docker ps -q --filter label=cynchor.range); N=$(docker network ls -q --filter label=cynchor.range)
echo "--- hardening (docker inspect)"
docker inspect "$C" --format 'ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} Privileged={{.HostConfig.Privileged}} SecurityOpt={{.HostConfig.SecurityOpt}} Memory={{.HostConfig.Memory}} PidsLimit={{.HostConfig.PidsLimit}} NanoCpus={{.HostConfig.NanoCpus}} Binds={{.HostConfig.Binds}} PortBindings={{.HostConfig.PortBindings}} User={{.Config.User}}'
docker network inspect "$N" --format 'Internal={{.Internal}}'
docker exec "$C" sh -c 'grep -E "^(CapEff|NoNewPrivs)" /proc/self/status; id -u; touch /opt/x 2>&1 | head -1; touch /app/ok && echo tmpfs-writable'
echo "--- isolation probes (every one except the loopback control must FAIL)"
docker exec "$C" sh -c 'wget -T 3 -q -O /dev/null http://127.0.0.1:8080/healthz && echo "control loopback: reachable (expected)"'
for t in "http://$(docker exec $C sh -c "ip route | awk '/default/ {print \$3}'"):80/" http://10.0.2.2/ http://1.1.1.1/ http://example.com/; do
  docker exec "$C" sh -c "wget -T 3 -q -O /dev/null $t" >/dev/null 2>&1 && echo "LEAK: $t reachable" || echo "blocked: $t"
done
echo "--- kill switch: non-operator (red1) then unauthenticated"
curl -s -w ' http=%{http_code}\n' -b $OUT/red1.jar "${H[@]}" -X POST $B/api/range/admin/kill -d "{\"matchId\":\"$M\"}"
echo "container still running: $(docker ps -q --filter label=cynchor.range | wc -l)"
echo "--- kill switch: operator"
T0=$(date +%s.%N)
curl -s -w ' http=%{http_code}\n' -b $OUT/op.jar "${H[@]}" -X POST $B/api/range/admin/kill -d "{\"matchId\":\"$M\"}"
echo "elapsed=$(echo "$(date +%s.%N) - $T0" | bc)s"
echo "containers left: $(docker ps -aq --filter label=cynchor.range | wc -l) networks left: $(docker network ls -q --filter label=cynchor.range | wc -l)"
echo "--- audit"
node --import tsx -e "import('./src/lib/db').then(m=>{for(const r of m.getDb().prepare(\"SELECT user_id,action,substr(details,1,90) d FROM audit_logs WHERE action IN ('RANGE_MATCH_KILLED','RANGE_MATCH_STARTED') ORDER BY rowid\").all())console.log(JSON.stringify(r))})" 2>/dev/null
curl -s -w ' http=%{http_code}\n' -b $OUT/op.jar "${H[@]}" -X POST $B/api/range/admin/kill -d "{\"matchId\":\"$M\"}"
