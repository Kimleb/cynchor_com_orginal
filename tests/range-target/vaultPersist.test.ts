// Real-container check: a drained vault survives a live patch restart (DB on the /data tmpfs), and the container
// hardening is unchanged. Needs a reachable Docker/Podman engine.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.CYNCHOR_DB_PATH = '.test.sqlite.range.vault';
process.env.IP_HASH_SALT ??= 'test-only-salt';
type Orch = typeof import('../../src/lib/range-runtime/orchestrator');
type Dock = typeof import('../../src/lib/range-runtime/dockerClient');
type Http = typeof import('../../src/lib/range-runtime/targetHttp');
type Db = typeof import('../../src/lib/db');
let orch: Orch, dock: Dock, http: Http, dbm: Db;
before(async () => {
  for (const f of ['', '-wal', '-shm']) fs.rmSync(`.test.sqlite.range.vault${f}`, { force: true });
  orch = await import('../../src/lib/range-runtime/orchestrator');
  dock = await import('../../src/lib/range-runtime/dockerClient');
  http = await import('../../src/lib/range-runtime/targetHttp');
  dbm = await import('../../src/lib/db');
});
after(async () => {
  const left = await dock.listByLabel(orch.RANGE_LABEL);
  for (const c of left.containers) await dock.removeContainer(c).catch(() => {});
  for (const n of left.networks) await dock.removeNetwork(n).catch(() => {});
});
test('vault stays swept across a patch restart and hardening is intact', { timeout: 300_000 }, async () => {
  const sessionId = `vp_${Date.now()}`;
  dbm.getDb().prepare("INSERT INTO match_sessions (id, mode, status, created_at) VALUES (?, 'RANGE', 'ACTIVE', ?)").run(sessionId, new Date().toISOString());
  const row = await orch.startMatch(sessionId);
  const cid = row.container_id!;
  try {
    const g = await http.requestTarget(cid, { method: 'POST', path: '/login', body: { username: 'guest', password: 'guest' } });
    const cookie = g.setCookie[0].split(';')[0];
    const sweep = await http.requestTarget(cid, { method: 'POST', path: '/internal/admin/vault', body: { toId: 3 }, cookie });
    assert.equal(sweep.status, 200);
    const read = async () => (await http.requestTarget(cid, { method: 'GET', path: '/internal/admin/vault' })).body;
    assert.match(String(await read()), /"balance_cents":0/);
    const src = fs.readFileSync('range-target/server.js', 'utf8');
    assert.deepEqual(await http.patchTargetFile(cid, 'server.js', `${src}\n// benign change\n`), { ok: true });
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { ok = (await http.requestTarget(cid, { method: 'GET', path: '/healthz' })).status === 200; } catch { /* restarting */ }
    }
    assert.ok(ok, '/healthz ok after restart');
    assert.match(String(await read()), /"balance_cents":0/, 'vault still 0 after restart');
    const info = await dock.inspectContainer(cid);
    const hc = info!.HostConfig as Record<string, any>;
    assert.equal(hc.ReadonlyRootfs, true);
    // Podman's inspect expands CapDrop, so check the effective capability set from inside instead.
    assert.match((await dock.execInContainer(cid, ['sh', '-c', 'grep ^CapEff /proc/self/status'])).output, /CapEff:\s+0+\s*$/);
    assert.ok(hc.SecurityOpt.includes('no-new-privileges'));
    assert.equal((await dock.inspectNetwork(row.network_id!))?.Internal, true);
    assert.ok(Object.keys(hc.Tmpfs).sort().join() === '/app,/data,/tmp');
  } finally {
    await orch.stopMatch(sessionId).catch(() => {});
  }
});
