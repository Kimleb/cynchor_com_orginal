# Fintech Range: final report (FEAT-005)

Branch `feature/fintech-range`. All evidence below is from real commands and a real Podman container (Docker CLI to rootless Podman 5.4.2).

## Checks
| Check | Result |
|---|---|
| `git diff --stat main -- src/lib/session.ts src/lib/guards.ts src/middleware.ts` | empty (untouched) |
| Concatenated SQL grep over `src` and `range-target` | only `range-target/server.js:49` (login handler, marked `DELIBERATELY-VULNERABLE-SQL`). The two other hits are Docker API `DELETE` URLs in dockerClient.ts, not SQL. `tests/rangeTargetSqlIsolation.test.ts` also enforces this. |
| `npm test` | 47/47 pass |
| `npm run test:range-target` | 13/13 pass (7 exploit proofs, 5 isolation incl. timeout and kill, 1 live match on a real container) |
| `npm run build` | exit 0, all `/range/*` and `/api/range/*` routes listed |

## Isolation: implementation and verification
Implementation (src/lib/range-runtime/orchestrator.ts): one container and one `--internal` network per match, both labelled `cynchor.range`; non-root user (uid 1000), read-only rootfs, tmpfs `/app`, CapDrop ALL, no-new-privileges, not privileged, no binds, no published ports, memory 256MiB (no swap), pids 128, cpu 0.5. Players reach the target only through authenticated Next.js routes, which run requests inside the container via the engine exec API.

Verification on a live match started through `POST /api/range/queue` (script `e2e/kill-and-isolation.sh`, log `e2e/kill-and-isolation.log`):
- inspect: ReadonlyRootfs=true Privileged=false SecurityOpt=[no-new-privileges] Memory=268435456 PidsLimit=128 NanoCpus=5e8 Binds=[] PortBindings=map[] User=node; network Internal=true; ports empty.
- inside: CapEff=0, NoNewPrivs=1, uid 1000, `touch /opt/x` fails (read-only), `/app` tmpfs writable.
- network: loopback control reachable; 10.0.2.2, 1.1.1.1 and example.com all blocked. An internal network has no default gateway, so the gateway probe was empty (blocked).
- `tests/range-target/isolation.test.ts` (pass, fresh containers): container cannot reach a second match container (with positive control), the host listener via gateway/host IPs/10.0.2.2/host.containers.internal, 1.1.1.1 or DNS.

## Kill switch (live match)
- Non-operator (red player): HTTP 403, container still running.
- Operator: HTTP 200 in 0.25 s, container and network gone (0 left), audit rows `RANGE_MATCH_KILLED` (user = operator) and `RANGE_MATCH_STARTED`. A second kill returns 404.

## Exploit-proof tests
`tests/range-target/exploits.test.ts` (7): SQLi login bypass, IDOR on /account/4, negative transfer, open admin, vault sweep, and the patched variants. The scorer reuses the same checks (`exploitChecks.ts`).

## Sample After Action Report
Real match over HTTP (2 red + 2 blue, `e2e/run.sh`): red exploited open admin, blue patched it live (scorer then logged EXPLOIT_BLOCKED), red swept the vault to 0, winner RED. Full JSON: `e2e/final-report-sample.json`. Score 2 landed / 1 blocked / 1 patch; MVP red RedOne, blue BlueOne. No emails in report, leaderboard or rendered pages (0 matches). SSE feeds: spectator saw no RED/BLUE-only events.

## Schema changes
- New table `range_target_matches` (id, match_session_id, container_id, network_id, status, vault_balance_cents, started_at, ended_at, timeout_at), created with `CREATE TABLE IF NOT EXISTS` in `initSchema()`.
- No new columns on existing tables. Range events reuse `audit_logs` (new action names) and matches reuse `match_sessions` with mode `RANGE`.

## Review notes
- Auth: every `/api/range/*` handler calls `getCurrentUser()` first. Kill route is operator-only and checks before any destroy. Proxy is Red-only and patch is Blue-only, side taken from the DB, not the client. Rate limits on queue, proxy and patch. Pages under `/range` guarded by `requireUser({profile:true})`. Events, report, leaderboard require login only (spectating is intended).
- Known limits: orchestrator and scorer timers are in-process (no reaper after a server restart; orphans carry the `cynchor.range` label). A live patch restarts the target and resets its in-memory DB and vault. The React client was not driven in a browser; SSE and server-rendered pages were verified over HTTP.

## Branch diff vs main
```
 .agents/tasks/fintech-range/ASSUMPTIONS.md         |  29 +
 .../tasks/fintech-range/e2e/report-evidence.json   |   1 +
 .agents/tasks/fintech-range/e2e/run-output.log     |  55 ++
 .agents/tasks/fintech-range/e2e/run.sh             |  61 ++
 .agents/tasks/fintech-range/e2e/seed.ts            |  18 +
 .agents/tasks/fintech-range/features/FEAT-001.json |  33 +
 .agents/tasks/fintech-range/features/FEAT-002.json |  32 +
 .agents/tasks/fintech-range/features/FEAT-003.json |  33 +
 .github/workflows/ci.yml                           |  14 +
 package.json                                       |   3 +-
 range-target/Dockerfile                            |  12 +
 range-target/README.md                             |  29 +
 range-target/db.js                                 |  60 ++
 range-target/entrypoint.sh                         |  14 +
 range-target/package-lock.json                     | 840 +++++++++++++++++++++
 range-target/package.json                          |  14 +
 range-target/server.js                             | 158 ++++
 src/app/api/range/[matchId]/events/route.ts        |  86 +++
 src/app/api/range/[matchId]/patch/route.ts         |  47 ++
 src/app/api/range/[matchId]/proxy/route.ts         |  58 ++
 src/app/api/range/[matchId]/report/route.ts        |  22 +
 src/app/api/range/admin/kill/route.ts              |  27 +
 src/app/api/range/leaderboard/route.ts             |  17 +
 src/app/api/range/queue/route.ts                   |  95 +++
 src/app/range/layout.tsx                           |   6 +
 src/app/range/leaderboard/page.tsx                 |  37 +
 src/app/range/lobby/page.tsx                       | 114 +++
 src/app/range/match/[matchId]/page.tsx             |  22 +
 src/app/range/match/[matchId]/report/page.tsx      |  64 ++
 src/app/range/page.tsx                             |  30 +
 src/app/range/spectate/[matchId]/page.tsx          |  11 +
 src/components/range/AttackConsole.tsx             |  56 ++
 src/components/range/MatchView.tsx                 |  37 +
 src/components/range/PatchConsole.tsx              |  47 ++
 src/components/range/RangeFeed.tsx                 |  45 ++
 src/components/range/SpectatorView.tsx             |  38 +
 src/components/range/VaultMeter.tsx                |  28 +
 src/components/range/useRangeEvents.ts             |  49 ++
 src/lib/db.ts                                      |  69 ++
 src/lib/range-runtime/dockerClient.ts              | 179 +++++
 src/lib/range-runtime/exploitChecks.ts             |  61 ++
 src/lib/range-runtime/lobby.ts                     | 142 ++++
 src/lib/range-runtime/orchestrator.ts              | 178 +++++
 src/lib/range-runtime/reports.ts                   | 132 ++++
 src/lib/range-runtime/scorer.ts                    | 126 ++++
 src/lib/range-runtime/targetHttp.ts                |  67 ++
 tests/range-target/exploits.test.ts                | 113 +++
 tests/range-target/isolation.test.ts               | 144 ++++
 tests/range-target/liveMatch.test.ts               | 115 +++
 tests/rangeQueueAndMatch.test.ts                   | 169 +++++
 tests/rangeTargetSqlIsolation.test.ts              |  39 +
 51 files changed, 3875 insertions(+), 1 deletion(-)
```
