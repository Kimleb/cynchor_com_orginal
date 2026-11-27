// DB-level reaper tests with stubbed Docker deps. The reaper ENDS stale matches, it never resumes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalDatabase as getDb, createRangeMatch, updateRangeMatch, getRangeMatch, endRangeMatch } from '../src/lib/db';
import { joinRangeQueue, getRangeEvents } from '../src/lib/range-runtime/lobby';
import { reapOrphans, REAPER_GRACE_MS, type ReaperDeps } from '../src/lib/range-runtime/reaper';
import { reconcileEndedMatches } from '../src/lib/range-runtime/scorer';
import type { StopFn } from '../src/lib/range-runtime/lobby';
const tag = `rp${Date.now()}`;
let seq = 0;
function seedTeam(side: 'RED' | 'BLUE') {
  const db = getDb();
  const id = `t_${side}_${tag}_${++seq}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO teams (id, name, side, leader_id, is_complete, status, created_at) VALUES (?, ?, ?, 'x', 1, 'RECRUITING', ?)").run(id, id, side, now);
  const uid = `u_${id}`;
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)").run(uid, uid, now);
  db.prepare('INSERT INTO team_members (id, team_id, user_id, joined_at) VALUES (?, ?, ?, ?)').run(`tm_${uid}`, id, uid, now);
  const uid2 = `${uid}b`;
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)").run(uid2, uid2, now);
  db.prepare('INSERT INTO team_members (id, team_id, user_id, joined_at) VALUES (?, ?, ?, ?)').run(`tm_${uid2}`, id, uid2, now);
  return { id, uid };
}
function running(opts: { ageMs: number; timeoutInMs: number }) {
  getDb().prepare("DELETE FROM matchmaking_queue WHERE status = 'WAITING'").run();
  const red = seedTeam('RED');
  const blue = seedTeam('BLUE');
  joinRangeQueue(red.uid, red.id, 2);
  const r = joinRangeQueue(blue.uid, blue.id, 2);
  if (r.kind !== 'matched') throw new Error('pairing failed');
  const rtm = createRangeMatch(r.sessionId, new Date(Date.now() + opts.timeoutInMs).toISOString());
  updateRangeMatch(rtm.id, { container_id: `c_${rtm.id}`, network_id: `n_${rtm.id}`, status: 'RUNNING' });
  getDb().prepare('UPDATE range_target_matches SET started_at = ? WHERE id = ?').run(new Date(Date.now() - opts.ageMs).toISOString(), rtm.id);
  return { sessionId: r.sessionId, rowId: rtm.id, redId: red.id };
}
const stop: StopFn = async (id, o) => { const rtm = getRangeMatch(id); return rtm !== undefined && endRangeMatch(rtm.id, o.reason); };
function deps(liveIds: string[], destroyed: string[]): ReaperDeps {
  return {
    isLive: (id) => liveIds.includes(id),
    reapMatch: async (row, reason) => { destroyed.push(row.id); return endRangeMatch(row.id, reason, undefined, reason === 'TIMEOUT' ? 'reaped: timeout_at passed' : 'reaped: server restarted'); },
    reconcile: () => reconcileEndedMatches(stop),
    listByLabel: async () => ({ containers: [], networks: [] }),
  };
}
const audit = (rowId: string) => (getDb().prepare('SELECT action FROM audit_logs WHERE details LIKE ?').all(`range match ${rowId}%`) as Array<{ action: string }>).map((a) => a.action);
test('a row past timeout_at is ended as TIMEOUT with an audit row and frees the teams', async () => {
  const m = running({ ageMs: REAPER_GRACE_MS + 5000, timeoutInMs: -1000 });
  const destroyed: string[] = [];
  await reapOrphans(deps([m.rowId], destroyed)); // even a live row is reaped once overdue
  assert.ok(destroyed.includes(m.rowId));
  assert.equal(getRangeMatch(m.sessionId)?.status, 'TIMEOUT');
  assert.ok(audit(m.rowId).includes('RANGE_MATCH_TIMEOUT'));
  assert.equal((getDb().prepare('SELECT status AS s FROM match_sessions WHERE id = ?').get(m.sessionId) as { s: string }).s, 'ENDED');
  assert.equal((getDb().prepare('SELECT status AS s FROM teams WHERE id = ?').get(m.redId) as { s: string }).s, 'RECRUITING');
  assert.ok(getRangeEvents(m.sessionId, 'SPECTATOR', 0).some((e) => e.action === 'RANGE_MATCH_ENDED'), 'After Action Report summary written');
});
test('an orphan row not in the live map is ended as KILLED (never resumed)', async () => {
  const m = running({ ageMs: REAPER_GRACE_MS + 5000, timeoutInMs: 600_000 });
  await reapOrphans(deps([], []));
  assert.equal(getRangeMatch(m.sessionId)?.status, 'KILLED');
  assert.ok(audit(m.rowId).includes('RANGE_MATCH_KILLED'));
});
test('a live, in-time row is untouched', async () => {
  const m = running({ ageMs: REAPER_GRACE_MS + 5000, timeoutInMs: 600_000 });
  const destroyed: string[] = [];
  await reapOrphans(deps([m.rowId], destroyed));
  assert.equal(destroyed.includes(m.rowId), false);
  assert.equal(getRangeMatch(m.sessionId)?.status, 'RUNNING');
});
test('a row younger than 30 s is untouched even when not live', async () => {
  const m = running({ ageMs: 2000, timeoutInMs: 600_000 });
  const destroyed: string[] = [];
  await reapOrphans(deps([], destroyed));
  assert.equal(destroyed.includes(m.rowId), false);
  assert.equal(getRangeMatch(m.sessionId)?.status, 'RUNNING');
});
test('labelled Docker objects not owned by an active row are removed, owned ones kept', async () => {
  getDb().prepare("UPDATE range_target_matches SET status = 'KILLED' WHERE status IN ('STARTING','RUNNING')").run();
  const m = running({ ageMs: REAPER_GRACE_MS + 5000, timeoutInMs: 600_000 });
  const removed: string[] = [];
  const d = deps([m.rowId], []);
  d.listByLabel = async () => ({ containers: [`c_${m.rowId}`, 'orphan-c'], networks: [`n_${m.rowId}`, 'orphan-n'] });
  d.removeContainer = async (id) => { removed.push(id); };
  d.removeNetwork = async (id) => { removed.push(id); };
  const r = await reapOrphans(d);
  assert.deepEqual(removed.sort(), ['orphan-c', 'orphan-n']);
  assert.equal(r.containersRemoved + r.networksRemoved, 2);
});
