// DB-level range queue/match tests. No Docker: the container stop and the target transport are stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalDatabase as getDb, createRangeMatch, updateRangeMatch, getRangeMatch, endRangeMatch, recordLocalAuditLog as recordAuditLog } from '../src/lib/db';
import { joinRangeQueue, getMatchAccess, endRangeSession, getRangeEvents, recordRangeEvent, type StopFn } from '../src/lib/range-runtime/lobby';
import { scoreTick, reconcileEndedMatches } from '../src/lib/range-runtime/scorer';
import type { Transport } from '../src/lib/range-runtime/exploitChecks';
const tag = `rq${Date.now()}`;
let seq = 0;
function seedTeam(side: 'RED' | 'BLUE', members: number) {
  const db = getDb();
  const id = `t_${side}_${tag}_${++seq}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO teams (id, name, side, leader_id, is_complete, status, created_at) VALUES (?, ?, ?, 'x', 1, 'RECRUITING', ?)").run(id, id, side, now);
  const users: string[] = [];
  for (let i = 0; i < members; i++) {
    const uid = `u_${id}_${i}`;
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)").run(uid, uid, now);
    db.prepare('INSERT INTO team_members (id, team_id, user_id, joined_at) VALUES (?, ?, ?, ?)').run(`tm_${uid}`, id, uid, now);
    users.push(uid);
  }
  return { id, users };
}
const stopStub = (calls: string[]): StopFn => async (id, o) => {
  calls.push(`${id}:${o.reason}`);
  const rtm = getRangeMatch(id);
  if (rtm === undefined || (rtm.status !== 'RUNNING' && rtm.status !== 'STARTING')) return false;
  return endRangeMatch(rtm.id, o.reason);
};
function pair() {
  getDb().prepare("DELETE FROM matchmaking_queue WHERE status = 'WAITING'").run(); // drop seeded demo queue entries
  const red = seedTeam('RED', 2);
  const blue = seedTeam('BLUE', 2);
  assert.equal(joinRangeQueue(red.users[0], red.id, 2).kind, 'queued');
  const r = joinRangeQueue(blue.users[0], blue.id, 2);
  assert.equal(r.kind, 'matched');
  if (r.kind !== 'matched') throw new Error('unreachable');
  return { red, blue, sessionId: r.sessionId };
}
// Marks the match as running with a fake container id, as startMatch would.
function runRange(sessionId: string, timeoutAt = new Date(Date.now() + 60_000).toISOString()) {
  const rtm = createRangeMatch(sessionId, timeoutAt);
  updateRangeMatch(rtm.id, { container_id: 'stub-container', network_id: 'stub-net', status: 'RUNNING' });
  return rtm;
}
test('pairing a Red and a Blue team of the minimum size creates one RANGE match session', () => {
  const { red, blue, sessionId } = pair();
  const db = getDb();
  const row = db.prepare('SELECT mode, status, red_team_id, blue_team_id FROM match_sessions WHERE id = ?').get(sessionId) as Record<string, string>;
  assert.deepEqual({ ...row }, { mode: 'RANGE', status: 'ACTIVE', red_team_id: red.id, blue_team_id: blue.id });
  assert.equal((db.prepare('SELECT status AS s FROM teams WHERE id = ?').get(red.id) as { s: string }).s, 'MATCHED');
  // Joining again returns the same session instead of creating a second one.
  const again = joinRangeQueue(red.users[1], red.id, 2);
  assert.equal(again.kind === 'matched' && again.sessionId === sessionId && again.created === false, true);
});
test('a team below the minimum size cannot queue, and a non-member cannot queue a team', () => {
  const small = seedTeam('RED', 1);
  assert.deepEqual(joinRangeQueue(small.users[0], small.id, 2), { kind: 'too_small', min: 2 });
  const full = seedTeam('BLUE', 2);
  assert.equal(joinRangeQueue(small.users[0], full.id, 2).kind, 'forbidden');
});
test('only members of the match get access, with the side taken from the database', () => {
  const { red, blue, sessionId } = pair();
  const outsider = seedTeam('RED', 2).users[0];
  assert.equal(getMatchAccess(outsider, sessionId), null, 'non-member is refused (routes answer 403)');
  assert.equal(getMatchAccess(red.users[0], sessionId)?.side, 'RED');
  assert.equal(getMatchAccess(blue.users[1], sessionId)?.side, 'BLUE');
  assert.equal(getMatchAccess(red.users[0], 'match_missing'), null);
});
test('ending a range match frees both teams like endMatch() and writes one summary', async () => {
  const { red, blue, sessionId } = pair();
  runRange(sessionId);
  const calls: string[] = [];
  assert.equal(await endRangeSession(sessionId, 'killed', stopStub(calls)), true);
  assert.equal(await endRangeSession(sessionId, 'killed', stopStub(calls)), false, 'second end is a no-op');
  const db = getDb();
  assert.equal((db.prepare('SELECT status AS s FROM match_sessions WHERE id = ?').get(sessionId) as { s: string }).s, 'ENDED');
  assert.equal((db.prepare('SELECT status AS s FROM teams WHERE id = ?').get(red.id) as { s: string }).s, 'RECRUITING');
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM matchmaking_queue WHERE team_id IN (?, ?)').get(red.id, blue.id) as { c: number }).c, 0);
  assert.equal(getRangeMatch(sessionId)?.status, 'KILLED');
  assert.equal(calls[0], `${sessionId}:KILLED`);
  const summaries = getRangeEvents(sessionId, 'SPECTATOR', 0).filter((e) => e.action === 'RANGE_MATCH_ENDED');
  assert.equal(summaries.length, 1);
  assert.match(summaries[0].details, /reason=killed winner=none/);
});
test('reconcile ends the session when the orchestrator already timed the container out', async () => {
  const { red, sessionId } = pair();
  const rtm = runRange(sessionId);
  endRangeMatch(rtm.id, 'TIMEOUT', undefined, 'test');
  assert.ok((await reconcileEndedMatches(stopStub([]))) >= 1);
  assert.equal((getDb().prepare('SELECT status AS s FROM match_sessions WHERE id = ?').get(sessionId) as { s: string }).s, 'ENDED');
  assert.equal((getDb().prepare('SELECT status AS s FROM teams WHERE id = ?').get(red.id) as { s: string }).s, 'RECRUITING');
});
test('feeds are filtered by side and the spectator only gets aggregate events', () => {
  const { red, blue, sessionId } = pair();
  recordRangeEvent({ matchId: sessionId, scope: 'RED', action: 'RANGE_PROXY_REQUEST', userId: red.users[0], details: 'GET /x -> 200' });
  recordRangeEvent({ matchId: sessionId, scope: 'BLUE', action: 'RANGE_PATCH_APPLIED', userId: blue.users[0], details: 'patched server.js' });
  recordRangeEvent({ matchId: sessionId, scope: 'ALL', action: 'RANGE_EXPLOIT_LANDED', userId: red.users[0], details: 'exploit=sqli-login' });
  const names = (v: 'RED' | 'BLUE' | 'SPECTATOR') => getRangeEvents(sessionId, v, 0).map((e) => e.action);
  assert.ok(names('RED').includes('RANGE_PROXY_REQUEST') && !names('RED').includes('RANGE_PATCH_APPLIED'));
  assert.ok(names('BLUE').includes('RANGE_PATCH_APPLIED') && !names('BLUE').includes('RANGE_PROXY_REQUEST'));
  assert.ok(names('SPECTATOR').includes('RANGE_EXPLOIT_LANDED') && !names('SPECTATOR').includes('RANGE_PROXY_REQUEST') && !names('SPECTATOR').includes('RANGE_PATCH_APPLIED'));
  assert.equal(getRangeEvents(sessionId, 'SPECTATOR', 0).every((e) => e.userName === null), true, 'spectators see no player names');
  // Another match never leaks in.
  const other = pair();
  assert.equal(getRangeEvents(other.sessionId, 'RED', 0).some((e) => e.details.includes(sessionId)), false);
});
// A fake target that is vulnerable until `patched` and whose vault can be drained.
function fakeTarget(state: { vault: number; patched: boolean; healthy: boolean }): Transport {
  return async (method, path, body) => {
    const reply = (status: number, json: unknown = null) => ({ status, json, text: JSON.stringify(json), cookie: 'fc_sid=ab12' });
    if (path === '/healthz') return state.healthy ? reply(200, { ok: true }) : reply(502);
    if (path === '/internal/admin/vault' && method === 'GET') return reply(200, { id: 1, balance_cents: state.vault });
    if (state.patched) return reply(403, { error: 'patched' });
    if (path === '/login') return reply(200, { ok: true, username: (body as { username: string }).username.startsWith('alex') ? 'alex' : 'guest' });
    if (path === '/account/2') return reply(200, { owner_username: 'jordan' });
    if (path === '/transfer') return reply(200, { ok: true });
    if (path === '/internal/admin/accounts') return reply(200, { accounts: [] });
    if (path === '/internal/admin/vault' && method === 'POST') return reply(400, { error: 'valid toId required' });
    return reply(404);
  };
}
test('scorer reads the vault, credits the Red player, records BLOCKED after a patch, and ends on vault zero', async () => {
  const { red, blue, sessionId } = pair();
  runRange(sessionId);
  const state = { vault: 50_000_000, patched: false, healthy: false };
  const calls: string[] = [];
  const deps = { transport: () => fakeTarget(state), stop: stopStub(calls) };
  assert.deepEqual(await scoreTick(sessionId, deps), { status: 'unhealthy' }, 'a down target is not scored');
  assert.equal(getRangeEvents(sessionId, 'SPECTATOR', 0).filter((e) => e.action.startsWith('RANGE_EXPLOIT')).length, 0);
  state.healthy = true;
  recordRangeEvent({ matchId: sessionId, scope: 'RED', action: 'RANGE_PROXY_REQUEST', userId: red.users[0], details: 'POST /login -> 200' });
  state.vault = 49_000_000;
  const t1 = await scoreTick(sessionId, deps);
  assert.equal(t1.status === 'scored' && t1.vault === 49_000_000 && t1.landed.length === 5, true);
  assert.equal(getRangeMatch(sessionId)?.vault_balance_cents, 49_000_000);
  const landed = getRangeEvents(sessionId, 'SPECTATOR', 0).filter((e) => e.action === 'RANGE_EXPLOIT_LANDED');
  assert.equal(landed.length, 1);
  assert.match(landed[0].details, /exploit=sqli-login/);
  await scoreTick(sessionId, deps);
  assert.equal(getRangeEvents(sessionId, 'SPECTATOR', 0).filter((e) => e.action === 'RANGE_EXPLOIT_LANDED').length, 1, 'no duplicate credit');
  // Blue patches; the next probes see every exploit blocked.
  recordRangeEvent({ matchId: sessionId, scope: 'BLUE', action: 'RANGE_PATCH_APPLIED', userId: blue.users[0], details: 'patched server.js' });
  state.patched = true;
  const t2 = await scoreTick(sessionId, deps);
  assert.equal(t2.status === 'scored' && t2.blocked.length === 5, true);
  const blocked = getRangeEvents(sessionId, 'SPECTATOR', 0).filter((e) => e.action === 'RANGE_EXPLOIT_BLOCKED');
  assert.equal(blocked.length, 5);
  // Boss: the vault hits zero and the match ends in a Red win.
  recordRangeEvent({ matchId: sessionId, scope: 'RED', action: 'RANGE_PROXY_REQUEST', userId: red.users[1], details: 'POST /internal/admin/vault -> 200' });
  state.vault = 0;
  assert.deepEqual(await scoreTick(sessionId, deps), { status: 'ended', reason: 'vault-zero' });
  assert.equal(getRangeMatch(sessionId)?.status, 'ENDED');
  assert.equal(getRangeMatch(sessionId)?.vault_balance_cents, 0);
  const summary = getRangeEvents(sessionId, 'SPECTATOR', 0).find((e) => e.action === 'RANGE_MATCH_ENDED');
  assert.ok(summary);
  assert.match(summary.details, new RegExp(`winner=RED .*mvp_red=${red.users[1]}\\(1\\)|winner=RED .*mvp_red=${red.users[0]}\\(1\\)`));
  assert.match(summary.details, new RegExp(`mvp_blue=${blue.users[0]}\\(1\\)`));
  assert.equal((getDb().prepare('SELECT status AS s FROM match_sessions WHERE id = ?').get(sessionId) as { s: string }).s, 'ENDED');
  assert.deepEqual(await scoreTick(sessionId, deps), { status: 'inactive' });
});
test('scorer ends a match whose timeout has passed', async () => {
  const { sessionId } = pair();
  runRange(sessionId, new Date(Date.now() - 1000).toISOString());
  const calls: string[] = [];
  assert.deepEqual(await scoreTick(sessionId, { transport: () => fakeTarget({ vault: 1, patched: false, healthy: true }), stop: stopStub(calls) }), { status: 'ended', reason: 'timeout' });
  assert.equal(getRangeMatch(sessionId)?.status, 'TIMEOUT');
  recordAuditLog({ action: 'RANGE_TEST_DONE' });
});
test('scorer drops its per-match state when the timeout branch ends the match', async () => {
  const { sessionId } = pair();
  const rtm = runRange(sessionId);
  const deps = { transport: () => fakeTarget({ vault: 1000, patched: false, healthy: true }), stop: stopStub([]) };
  assert.equal((await scoreTick(sessionId, deps)).status, 'scored');
  const scorerState = (globalThis as unknown as { __rangeScorer: { state: Map<string, unknown> } }).__rangeScorer.state;
  assert.equal(scorerState.has(sessionId), true);
  getDb().prepare('UPDATE range_target_matches SET timeout_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), rtm.id);
  assert.deepEqual(await scoreTick(sessionId, deps), { status: 'ended', reason: 'timeout' });
  assert.equal(scorerState.has(sessionId), false);
});
test('a vault read rising above the floor is clamped to the floor and audited once', async () => {
  const { sessionId } = pair();
  runRange(sessionId);
  const state = { vault: 30_000_000, patched: false, healthy: true };
  const deps = { transport: () => fakeTarget(state), stop: stopStub([]) };
  await scoreTick(sessionId, deps);
  assert.equal(getRangeMatch(sessionId)?.vault_balance_cents, 30_000_000);
  state.vault = 50_000_000; // Blue's patched code reseeded the target
  const t = await scoreTick(sessionId, deps);
  assert.equal(t.status === 'scored' && t.vault === 30_000_000, true);
  await scoreTick(sessionId, deps);
  assert.equal(getRangeMatch(sessionId)?.vault_balance_cents, 30_000_000, 'floor only decreases');
  const resets = getRangeEvents(sessionId, 'SPECTATOR', 0).filter((e) => e.action === 'RANGE_VAULT_RESET_DETECTED');
  assert.equal(resets.length, 1);
  state.vault = 20_000_000;
  await scoreTick(sessionId, deps);
  assert.equal(getRangeMatch(sessionId)?.vault_balance_cents, 20_000_000, 'a real drain still lowers the floor');
});
