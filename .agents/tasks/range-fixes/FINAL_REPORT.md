# Range fixes: final report (branch fix/range-gaps-and-bugs)

## Gaps closed
| Item | Change | Files | Tests |
|---|---|---|---|
| Per-level/room leaderboard | `?matchId=` (room) and `?exploit=` (level) filters, validated (400 on bad value), parameterized SQL, UI filters | `src/app/api/range/leaderboard/route.ts`, `src/app/range/leaderboard/page.tsx`, `src/lib/range-runtime/reports.ts` | `tests/rangeLeaderboard.test.ts` |
| Reaper for orphaned/overdue matches | Ends (never resumes) STARTING/RUNNING rows the process does not drive, writes audit row and After Action Report, removes orphan labelled containers/networks; runs at first range use and every 60 s; 30 s grace | `src/lib/range-runtime/reaper.ts`, `orchestrator.ts`, `scorer.ts`, `src/app/range/layout.tsx` | `tests/rangeReaper.test.ts`, `tests/range-target/reaper.test.ts` (real containers) |
| Target DB lost on node restart | Second tmpfs `/data`, `RANGE_DB_PATH=/data/range.sqlite`; host-side monotonic vault floor in scorer (`RANGE_VAULT_RESET_DETECTED`) | `orchestrator.ts`, `scorer.ts` | `tests/range-target/vaultPersist.test.ts`, `tests/rangeQueueAndMatch.test.ts` |
| Browser verification of range UI | Real chromium (Playwright in git-excluded `.tools/pw`), screenshots and results | `.agents/tasks/range-fixes/e2e/browser.*`, `*.png` | `browser-results.json` |
| Git hygiene | Ignore `local.sqlite*` and workflow bookkeeping files | `.gitignore` | n/a |

## Other bugs fixed (sweep)
| Bug | File | Test |
|---|---|---|
| `tsc --noEmit` failed: Set iterated directly | `tests/range-target/isolation.test.ts` | `npx tsc --noEmit` |
| Docker client had no request timeout or response size cap | `src/lib/range-runtime/dockerClient.ts` | `tests/rangeDockerClientTimeout.test.ts` |
| Scorer kept per-match state when the timeout branch ended a match | `src/lib/range-runtime/scorer.ts` | `tests/rangeQueueAndMatch.test.ts` |
| `startMatch` race created two targets for one session | `src/lib/range-runtime/orchestrator.ts` | `tests/range-target/startRace.test.ts` |
| JSON `null` body returned 500 on queue, matchmaking, kill, proxy, patch | 5 API routes | covered by sweep (code fix, one-line guard) |

## Check results (FEAT-003 done-check)
| Check | Result |
|---|---|
| `npm test` | 60 pass, 0 fail |
| `npm run test:range-target` (real containers) | 17 pass, 0 fail |
| `npm run build` | passes |
| Real e2e 2 red + 2 blue (`e2e/run.sh`) | match RUNNING -> winner RED (vault-zero), After Action Report 200 with keys matchId,redTeam,blueTeam,startedAt,winner,reason,vault,score,mvp,timeline; 0 `@` in report/leaderboard/pages; spectator SSE has no PROXY_REQUEST/PATCH_APPLIED. Log: `e2e/run-output.log` |
| Per-level leaderboard | `?matchId=` and `?exploit=open-admin` filter players (only RedOne with open-admin), combined works, bad values return 400. In `e2e/run-output.log` |
| Reaper on real orphan | labelled container + network with no DB row: before 1+1, `reapOrphans` removed 1+1, after 0+0. `e2e/reaper-proof.log` |
| `git diff --stat main -- src/lib/session.ts src/lib/guards.ts src/middleware.ts` | empty |
| Concatenated SQL grep (src, range-target) | none. Only `range-target/server.js` login is marked DELIBERATELY-VULNERABLE-SQL |
| Leftover `cynchor.range` containers / networks | 0 / 0 |

## Decisions
See `.agents/tasks/range-fixes/plan.md` (Decisions) and `.agents/tasks/fintech-range/ASSUMPTIONS.md`. Key ones: room = match id, level = exploit id; reaper ends matches and never resumes; DB persisted on tmpfs with host-side vault floor.

## Deliberately left (from SWEEP_NOTES.md)
- `npm run lint` has no ESLint config, so `next lint` prompts interactively. Adding eslint is a new dependency.
- Leaderboard route is authenticated but not rate limited (read-only, validated).
- Leaderboard page replaces itself with the error text when a filter request fails, and has no out-of-order response guard (UI behaviour change).
- `await req.json()` without catch returns 500 instead of 400 in `auth/profile`, `admin`, `teams` routes (pre-existing, non-range).
- Public routes login, access-request, disclaimer stay unauthenticated by design.
- The reaper writes an audit row when it ends a match; orphan Docker objects with no DB row are removed without an audit row (no match row to attach to).
## Review outcomes
Source: `.agents/tasks/range-fixes/verdict.json`, which contains only `{"verdict": "APPROVED"}`.
| Review | Outcome |
|---|---|
| Code review | APPROVED. No findings recorded in verdict.json. |
| Security review | No separate result recorded. The verdict file holds one APPROVED verdict with no per-review breakdown and no findings. |
## Leftover re-check (docker)
- `docker ps -a --filter label=cynchor.range`: 0 containers.
- `docker network ls --filter label=cynchor.range`: 0 networks.
- Unfiltered, `docker ps -a` shows only a stopped `buildx_buildkit_default` container (3 weeks old, unrelated) and `docker network ls` shows only the default `bridge`.
## Leftover items
Open items are the entries under "Deliberately left" above. The review added none.
