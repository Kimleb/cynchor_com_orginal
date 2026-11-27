import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb, endMatch, endStaleMatches } from '../src/lib/db';

async function seedMatch(tag: string, createdAt: string) {
  const db = getDb();
  const red = `t_red_${tag}`;
  const blue = `t_blue_${tag}`;
  const ses = `m_${tag}`;
  for (const [id, side] of [[red, 'RED'], [blue, 'BLUE']]) {
    await db.prepare("INSERT INTO teams (id, name, side, leader_id, is_complete, status, created_at) VALUES (?, ?, ?, 'x', 1, 'MATCHED', ?)").run(id, id, side, createdAt);
    await db.prepare("INSERT INTO matchmaking_queue (id, team_id, side, status, joined_at) VALUES (?, ?, ?, 'MATCHED', ?)").run(`q_${id}`, id, side, createdAt);
  }
  await db.prepare("INSERT INTO match_sessions (id, red_team_id, blue_team_id, mode, status, created_at) VALUES (?, ?, ?, 'TEAM', 'ACTIVE', ?)").run(ses, red, blue, createdAt);
  return { red, blue, ses };
}

test('endMatch frees both teams and clears their queue rows', async () => {
  const db = getDb();
  const { red, blue, ses } = await seedMatch(`a${Date.now()}`, new Date().toISOString());
  assert.equal(await endMatch(ses), true);
  assert.equal(await endMatch(ses), false);
  assert.equal(((await db.prepare('SELECT status AS s FROM match_sessions WHERE id = ?').get(ses)) as { s: string }).s, 'ENDED');
  assert.equal(((await db.prepare('SELECT status AS s FROM teams WHERE id = ?').get(red)) as { s: string }).s, 'RECRUITING');
  assert.equal(((await db.prepare('SELECT COUNT(*) AS c FROM matchmaking_queue WHERE team_id IN (?, ?)').get(red, blue)) as { c: number }).c, 0);
});

test('endStaleMatches ends matches older than the cutoff', async () => {
  const db = getDb();
  const old = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
  const { ses } = await seedMatch(`b${Date.now()}`, old);
  assert.ok((await endStaleMatches(4)) >= 1);
  assert.equal(((await db.prepare('SELECT status AS s FROM match_sessions WHERE id = ?').get(ses)) as { s: string }).s, 'ENDED');
});
