// DB-level leaderboard filter tests (room = match id, level = exploit id). No Docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalDatabase as getDb } from '../src/lib/db';
import { recordRangeEvent } from '../src/lib/range-runtime/lobby';
import { buildLeaderboard } from '../src/lib/range-runtime/reports';
const tag = `lb${Date.now()}`;
let seq = 0;
function seedTeam(side: 'RED' | 'BLUE') {
  const db = getDb();
  const id = `t_${side}_${tag}_${++seq}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO teams (id, name, side, leader_id, is_complete, status, created_at) VALUES (?, ?, ?, 'x', 1, 'RECRUITING', ?)").run(id, id, side, now);
  const uid = `u_${id}`;
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)").run(uid, `P_${id}`, now);
  return { id, uid, name: `P_${id}` };
}
function endedMatch(winner: 'RED' | 'BLUE', exploits: string[]) {
  const db = getDb();
  const red = seedTeam('RED');
  const blue = seedTeam('BLUE');
  const id = `ms_${tag}_${++seq}`;
  db.prepare("INSERT INTO match_sessions (id, mode, status, red_team_id, blue_team_id, created_at) VALUES (?, 'RANGE', 'ENDED', ?, ?, ?)").run(id, red.id, blue.id, new Date().toISOString());
  for (const x of exploits) recordRangeEvent({ matchId: id, scope: 'ALL', action: 'RANGE_EXPLOIT_LANDED', userId: red.uid, details: `exploit=${x} probe: ok` });
  recordRangeEvent({ matchId: id, scope: 'BLUE', action: 'RANGE_PATCH_APPLIED', userId: blue.uid, details: 'patched server.js' });
  recordRangeEvent({ matchId: id, scope: 'ALL', action: 'RANGE_MATCH_ENDED', details: `reason=test winner=${winner} vault_cents=1 mvp_red=none mvp_blue=none` });
  return { id, red, blue };
}
const a = endedMatch('RED', ['sqli-login', 'idor-account']);
const b = endedMatch('BLUE', ['idor-account']);
const row = (lb: ReturnType<typeof buildLeaderboard>, team: string) => lb.teams.find((t) => t.team === team);
const player = (lb: ReturnType<typeof buildLeaderboard>, name: string) => lb.players.find((p) => p.name === name);
test('unfiltered board counts both matches and lists them as filter options', () => {
  const lb = buildLeaderboard();
  assert.ok(lb.matchesPlayed >= 2);
  assert.deepEqual(row(lb, a.red.id), { team: a.red.id, side: 'RED', played: 1, wins: 1 });
  assert.deepEqual(row(lb, b.blue.id), { team: b.blue.id, side: 'BLUE', played: 1, wins: 1 });
  assert.deepEqual(player(lb, a.red.name), { name: a.red.name, exploits: 2, patches: 0 });
  assert.ok(lb.filters.matches.some((m) => m.id === a.id) && lb.filters.matches.some((m) => m.id === b.id));
  assert.equal(lb.filters.exploits.length, 5);
});
test('matchId restricts sessions, teams and players to that match', () => {
  const lb = buildLeaderboard({ matchId: a.id });
  assert.equal(lb.matchesPlayed, 1);
  assert.deepEqual(lb.teams.map((t) => t.team).sort(), [a.red.id, a.blue.id].sort());
  assert.deepEqual(player(lb, a.blue.name), { name: a.blue.name, exploits: 0, patches: 1 });
  assert.equal(player(lb, b.red.name), undefined);
});
test('exploit restricts to matches where it landed and counts only those landings, patches as 0', () => {
  const lb = buildLeaderboard({ exploit: 'sqli-login' });
  assert.equal(lb.matchesPlayed, 1);
  assert.equal(row(lb, b.red.id), undefined);
  assert.deepEqual(player(lb, a.red.name), { name: a.red.name, exploits: 1, patches: 0 });
  assert.equal(player(lb, a.blue.name), undefined);
  const idor = buildLeaderboard({ exploit: 'idor-account' });
  assert.ok(row(idor, a.red.id) && row(idor, b.red.id));
});
test('matchId and exploit combine', () => {
  const lb = buildLeaderboard({ matchId: b.id, exploit: 'idor-account' });
  assert.equal(lb.matchesPlayed, 1);
  assert.deepEqual(row(lb, b.blue.id), { team: b.blue.id, side: 'BLUE', played: 1, wins: 1 });
  assert.equal(buildLeaderboard({ matchId: b.id, exploit: 'sqli-login' }).matchesPlayed, 0);
  assert.equal(buildLeaderboard({ matchId: 'nope' }).matchesPlayed, 0);
});
test('output carries usernames only, no email', () => {
  assert.equal(JSON.stringify(buildLeaderboard()).includes('@'), false);
});
