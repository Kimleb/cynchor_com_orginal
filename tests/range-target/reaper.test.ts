// Real-container reaper check: an in-flight match that the process no longer drives is ENDED (never resumed), its
// container and network are removed, and an audit row is written. Needs a reachable Docker/Podman engine.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.CYNCHOR_DB_PATH = '.test.sqlite.range.reaper';
process.env.IP_HASH_SALT ??= 'test-only-salt';
type Orch = typeof import('../../src/lib/range-runtime/orchestrator');
type Dock = typeof import('../../src/lib/range-runtime/dockerClient');
type Reaper = typeof import('../../src/lib/range-runtime/reaper');
type Db = typeof import('../../src/lib/db');
let orch: Orch, dock: Dock, reaper: Reaper, dbm: Db;
before(async () => {
  for (const f of ['', '-wal', '-shm']) fs.rmSync(`.test.sqlite.range.reaper${f}`, { force: true });
  orch = await import('../../src/lib/range-runtime/orchestrator');
  dock = await import('../../src/lib/range-runtime/dockerClient');
  reaper = await import('../../src/lib/range-runtime/reaper');
  dbm = await import('../../src/lib/db');
});
after(async () => {
  const left = await dock.listByLabel(orch.RANGE_LABEL);
  for (const c of left.containers) await dock.removeContainer(c).catch(() => {});
  for (const n of left.networks) await dock.removeNetwork(n).catch(() => {});
});
function seedSession(): string {
  const db = dbm.openLocalDatabase();
  const id = `reap_${Date.now()}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO match_sessions (id, mode, status, created_at) VALUES (?, 'RANGE', 'ACTIVE', ?)").run(id, now);
  return id;
}
const age = (rowId: string) => dbm.openLocalDatabase().prepare('UPDATE range_target_matches SET started_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), rowId);
test('reaper ends an orphaned real match and removes its container and network', { timeout: 300_000 }, async () => {
  const sessionId = seedSession();
  const row = await orch.startMatch(sessionId);
  assert.equal(orch.isLive(row.id), true);
  const before = await dock.listByLabel(orch.RANGE_LABEL);
  assert.ok(before.containers.includes(row.container_id!) && before.networks.includes(row.network_id!));
  age(row.id);
  // Simulates a restart: the process no longer owns the match, but its container is still running.
  const r = await reaper.reapOrphans({ isLive: () => false });
  assert.equal(r.matchesEnded, 1);
  const ended = dbm.getRangeMatch(sessionId);
  assert.equal(ended?.status, 'KILLED');
  const actions = (dbm.openLocalDatabase().prepare('SELECT action FROM audit_logs WHERE details LIKE ?').all(`range match ${row.id}%`) as Array<{ action: string }>).map((a) => a.action);
  assert.ok(actions.includes('RANGE_MATCH_KILLED'));
  assert.deepEqual(await dock.listByLabel(orch.RANGE_LABEL), { containers: [], networks: [] });
  assert.equal(orch.isLive(row.id), false, 'timers are cleared');
});
test('reaper removes labelled objects that no active row owns', { timeout: 300_000 }, async () => {
  const sessionId = seedSession();
  const row = await orch.startMatch(sessionId);
  // The row is ended behind the orchestrator's back, leaving the container and network as orphans.
  dbm.endRangeMatch(row.id, 'KILLED', undefined, 'test orphan');
  age(row.id);
  const r = await reaper.reapOrphans({ isLive: () => true });
  assert.equal(r.containersRemoved, 1);
  assert.equal(r.networksRemoved, 1);
  assert.deepEqual(await dock.listByLabel(orch.RANGE_LABEL), { containers: [], networks: [] });
  await orch.stopMatch(sessionId).catch(() => {});
});
