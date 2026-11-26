// Real-container end-to-end check of the FEAT-003 lifecycle: queue pairing -> container -> attacker traffic -> scorer
// probes -> Blue patch -> boss exploit -> match end -> container and network gone. Needs a reachable Docker/Podman engine.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.CYNCHOR_DB_PATH = '.test.sqlite.range.live';
process.env.IP_HASH_SALT ??= 'test-only-salt';
type Orch = typeof import('../../src/lib/range-runtime/orchestrator');
type Dock = typeof import('../../src/lib/range-runtime/dockerClient');
type Lobby = typeof import('../../src/lib/range-runtime/lobby');
type Scorer = typeof import('../../src/lib/range-runtime/scorer');
type Http = typeof import('../../src/lib/range-runtime/targetHttp');
type Db = typeof import('../../src/lib/db');
let orch: Orch, dock: Dock, lobby: Lobby, scorer: Scorer, http: Http, dbm: Db;
before(async () => {
  for (const f of ['', '-wal', '-shm']) fs.rmSync(`.test.sqlite.range.live${f}`, { force: true });
  orch = await import('../../src/lib/range-runtime/orchestrator');
  dock = await import('../../src/lib/range-runtime/dockerClient');
  lobby = await import('../../src/lib/range-runtime/lobby');
  scorer = await import('../../src/lib/range-runtime/scorer');
  http = await import('../../src/lib/range-runtime/targetHttp');
  dbm = await import('../../src/lib/db');
});
after(async () => {
  const left = await dock.listByLabel(orch.RANGE_LABEL);
  for (const c of left.containers) await dock.removeContainer(c).catch(() => {});
  for (const n of left.networks) await dock.removeNetwork(n).catch(() => {});
});
function seedTeam(side: 'RED' | 'BLUE') {
  const db = dbm.getDb();
  const id = `live_${side}_${Date.now()}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO teams (id, name, side, leader_id, is_complete, status, created_at) VALUES (?, ?, ?, 'x', 1, 'RECRUITING', ?)").run(id, id, side, now);
  const users = [0, 1].map((i) => {
    const uid = `${id}_u${i}`;
    db.prepare("INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, 'x', ?, ?)").run(uid, `${uid}@example.test`, `P${i}`, now);
    db.prepare('INSERT INTO team_members (id, team_id, user_id, joined_at) VALUES (?, ?, ?, ?)').run(`tm_${uid}`, id, uid, now);
    return uid;
  });
  return { id, users };
}
const waitHealthy = async (id: string) => {
  const t = http.containerTransport(id);
  for (let i = 0; i < 30; i++) {
    try { if ((await t('GET', '/healthz')).status === 200) return; } catch { /* restarting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('target did not come back after patch');
};
test('a real match runs from queue pairing to boss-exploit end and leaves nothing behind', { timeout: 600_000 }, async () => {
  dbm.getDb().prepare("DELETE FROM matchmaking_queue WHERE status = 'WAITING'").run();
  const red = seedTeam('RED');
  const blue = seedTeam('BLUE');
  assert.equal(lobby.joinRangeQueue(red.users[0], red.id, 2).kind, 'queued');
  const paired = lobby.joinRangeQueue(blue.users[0], blue.id, 2);
  assert.equal(paired.kind, 'matched');
  if (paired.kind !== 'matched') return;
  const sessionId = paired.sessionId;
  const row = await orch.startMatch(sessionId, { userId: red.users[0] });
  assert.equal(row.status, 'RUNNING');
  const cid = row.container_id!;
  try {
    // Red attacks through the same request path the proxy route uses, and the proxy row is logged the same way.
    const attack = async (method: 'GET' | 'POST', path: string, body?: unknown, cookie?: string) => {
      const r = await http.requestTarget(cid, { method, path, body, cookie });
      lobby.recordRangeEvent({ matchId: sessionId, scope: 'RED', action: 'RANGE_PROXY_REQUEST', userId: red.users[0], details: `${method} ${path} -> ${r.status}` });
      return r;
    };
    const login = await attack('POST', '/login', { username: "alex' --", password: 'x' });
    assert.equal(login.status, 200);
    assert.match(login.setCookie[0], /^fc_sid=/);
    // Tick 1: real probes against the live container.
    const t1 = await scorer.scoreTick(sessionId);
    assert.equal(t1.status, 'scored');
    if (t1.status !== 'scored') return;
    assert.equal(t1.vault, 50_000_000);
    assert.ok(t1.landed.includes('sqli-login') && t1.landed.length === 5, `all five open at the start: ${t1.landed}`);
    assert.equal(dbm.getRangeMatch(sessionId)?.vault_balance_cents, 50_000_000);
    const feed1 = lobby.getRangeEvents(sessionId, 'SPECTATOR', 0);
    assert.ok(feed1.some((e) => e.action === 'RANGE_EXPLOIT_LANDED' && e.details.includes('exploit=sqli-login')));
    // Blue patches the open admin endpoint in the running container; the target restarts and the scorer sees it blocked.
    const src = fs.readFileSync('range-target/server.js', 'utf8');
    const needle = "app.get('/internal/admin/accounts', (_req, res) => {";
    assert.ok(src.includes(needle));
    const patched = await http.patchTargetFile(cid, 'server.js', src.replace(needle, `${needle} return res.status(403).json({ error: 'patched' });`));
    assert.deepEqual(patched, { ok: true });
    lobby.recordRangeEvent({ matchId: sessionId, scope: 'BLUE', action: 'RANGE_PATCH_APPLIED', userId: blue.users[0], details: 'patched server.js' });
    const broken = await http.patchTargetFile(cid, 'server.js', 'this is not javascript (');
    assert.equal(broken.ok, false, 'a syntax error is rejected before it reaches the target');
    await new Promise((r) => setTimeout(r, 1500));
    await waitHealthy(cid);
    const t2 = await scorer.scoreTick(sessionId);
    assert.equal(t2.status === 'scored' && t2.blocked.includes('open-admin') && !t2.blocked.includes('sqli-login'), true, JSON.stringify(t2));
    const blocked = lobby.getRangeEvents(sessionId, 'SPECTATOR', 0).find((e) => e.action === 'RANGE_EXPLOIT_BLOCKED');
    assert.ok(blocked?.details.includes('exploit=open-admin'));
    // Boss: sweep the vault. The scorer reads 0 off the container and ends the match.
    const g = await attack('POST', '/login', { username: 'guest', password: 'guest' });
    await attack('GET', '/account/4', undefined, g.setCookie[0].split(';')[0]);
    const sweep = await attack('POST', '/internal/admin/vault', { toId: 3 });
    assert.equal(sweep.status, 200);
    assert.deepEqual(await scorer.scoreTick(sessionId), { status: 'ended', reason: 'vault-zero' });
    assert.equal(dbm.getRangeMatch(sessionId)?.vault_balance_cents, 0);
    assert.equal(dbm.getRangeMatch(sessionId)?.status, 'ENDED');
    const db = dbm.getDb();
    assert.equal((db.prepare('SELECT status AS s FROM match_sessions WHERE id = ?').get(sessionId) as { s: string }).s, 'ENDED');
    assert.equal((db.prepare('SELECT status AS s FROM teams WHERE id = ?').get(red.id) as { s: string }).s, 'RECRUITING');
    const summary = lobby.getRangeEvents(sessionId, 'SPECTATOR', 0).find((e) => e.action === 'RANGE_MATCH_ENDED');
    assert.match(summary!.details, /winner=RED/);
    assert.match(summary!.details, new RegExp(`mvp_blue=${blue.users[0]}\\(1\\)`));
    const left = await dock.listByLabel(orch.RANGE_LABEL);
    assert.deepEqual(left, { containers: [], networks: [] }, 'container and network are gone');
  } finally {
    await orch.stopMatch(sessionId).catch(() => {});
  }
});
