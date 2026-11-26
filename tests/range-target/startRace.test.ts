// Two concurrent startMatch calls for the same match session must yield exactly one container. Needs Docker/Podman.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.CYNCHOR_DB_PATH = '.test.sqlite.range.startrace';
process.env.IP_HASH_SALT ??= 'test-only-salt';
type Orch = typeof import('../../src/lib/range-runtime/orchestrator');
type Dock = typeof import('../../src/lib/range-runtime/dockerClient');
type Db = typeof import('../../src/lib/db');
let orch: Orch, dock: Dock, dbm: Db;
before(async () => {
  for (const f of ['', '-wal', '-shm']) fs.rmSync(`.test.sqlite.range.startrace${f}`, { force: true });
  orch = await import('../../src/lib/range-runtime/orchestrator');
  dock = await import('../../src/lib/range-runtime/dockerClient');
  dbm = await import('../../src/lib/db');
});
after(async () => {
  const left = await dock.listByLabel(orch.RANGE_LABEL);
  for (const c of left.containers) await dock.removeContainer(c).catch(() => {});
  for (const n of left.networks) await dock.removeNetwork(n).catch(() => {});
});
test('concurrent startMatch for one session starts exactly one target', { timeout: 300_000 }, async () => {
  const id = `race_${Date.now()}`;
  dbm.getDb().prepare("INSERT INTO match_sessions (id, mode, status, created_at) VALUES (?, 'RANGE', 'ACTIVE', ?)").run(id, new Date().toISOString());
  const results = await Promise.allSettled([orch.startMatch(id), orch.startMatch(id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one start wins');
  const rows = dbm.getDb().prepare("SELECT status FROM range_target_matches WHERE match_session_id = ? AND status IN ('STARTING','RUNNING')").all(id);
  assert.equal(rows.length, 1, 'one active row');
  assert.equal((await dock.listByLabel(orch.RANGE_LABEL)).containers.length, 1, 'one container');
  await orch.stopMatch(id);
  assert.deepEqual(await dock.listByLabel(orch.RANGE_LABEL), { containers: [], networks: [] });
});
