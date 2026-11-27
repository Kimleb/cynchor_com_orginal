// Real-container isolation self-test. Needs a reachable Docker/Podman engine and the node:22-alpine base image.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

process.env.CYNCHOR_DB_PATH = '.test.sqlite.range';
process.env.IP_HASH_SALT ??= 'test-only-salt';

type Orch = typeof import('../../src/lib/range-runtime/orchestrator');
type Dock = typeof import('../../src/lib/range-runtime/dockerClient');
type Db = typeof import('../../src/lib/db');
let orch: Orch;
let dock: Dock;
let dbm: Db;
let hostListener: net.Server;
let hostPort = 0;

const unique = `iso_${Date.now()}`;
const A = `${unique}_a`;
const B = `${unique}_b`;

before(async () => {
  for (const f of ['', '-wal', '-shm']) fs.rmSync(`.test.sqlite.range${f}`, { force: true });
  orch = await import('../../src/lib/range-runtime/orchestrator');
  dock = await import('../../src/lib/range-runtime/dockerClient');
  dbm = await import('../../src/lib/db');
  // A listener on the host, reachable on every host address, that the match container must not reach.
  hostListener = net.createServer((s) => s.end('HOST-SECRET'));
  await new Promise<void>((r) => hostListener.listen(0, '0.0.0.0', r));
  hostPort = (hostListener.address() as AddressInfo).port;
});

after(async () => {
  hostListener?.close();
  await orch.stopMatch(A).catch(() => {});
  await orch.stopMatch(B).catch(() => {});
  const left = await dock.listByLabel(orch.RANGE_LABEL);
  for (const c of left.containers) await dock.removeContainer(c).catch(() => {});
  for (const n of left.networks) await dock.removeNetwork(n).catch(() => {});
});

const sh = (id: string, cmd: string) => dock.execInContainer(id, ['sh', '-c', cmd]);

test('match container is hardened, internal-only and healthy', { timeout: 300_000 }, async () => {
  const row = await orch.startMatch(A, { userId: 'user_op_001' });
  assert.equal(row.status, 'RUNNING');
  const info = await dock.inspectContainer(row.container_id!);
  assert.ok(info?.State.Running);
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  // Podman's inspect expands CapDrop, so check the effective capability set from inside instead.
  assert.match((await sh(row.container_id!, 'grep ^CapEff /proc/self/status')).output, /CapEff:\s+0+\s*$/);
  assert.match((await sh(row.container_id!, 'grep ^NoNewPrivs /proc/self/status')).output, /NoNewPrivs:\s+1/);
  assert.ok(info.HostConfig.SecurityOpt.includes('no-new-privileges'));
  assert.notEqual(info.HostConfig.Privileged, true);
  assert.deepEqual(Object.values(info.NetworkSettings.Ports ?? {}).filter(Boolean), [], 'no published ports');
  assert.equal(info.HostConfig.Memory, orch.LIMITS.memoryBytes);
  assert.equal(info.HostConfig.PidsLimit, orch.LIMITS.pids);
  const net = await dock.inspectNetwork(row.network_id!);
  assert.equal(net?.Internal, true);
  assert.equal((await sh(row.container_id!, 'id -u')).output.trim(), '1000');
  assert.notEqual((await sh(row.container_id!, 'touch /opt/x')).exitCode, 0, 'root fs is read-only');
  assert.equal((await sh(row.container_id!, 'touch /app/patched && echo ok')).exitCode, 0, 'tmpfs /app is writable');
  const vault = await sh(row.container_id!, 'wget -q -O - http://127.0.0.1:8080/internal/admin/vault');
  assert.match(vault.output, /50000000/);
});

test('container cannot reach the host, the internet, or another match', { timeout: 300_000 }, async () => {
  const a = dbm.getActiveRangeMatch(A)!;
  const b = await orch.startMatch(B);
  const ia = await dock.inspectContainer(a.container_id!);
  const ib = await dock.inspectContainer(b.container_id!);
  const ipB = Object.values(ib!.NetworkSettings.Networks)[0].IPAddress;
  assert.ok(ipB, 'second match has an IP');
  assert.notEqual(a.network_id, b.network_id);
  assert.ok(ia);

  const reach = async (id: string, url: string) => (await sh(id, `wget -T 3 -q -O - ${url} >/dev/null 2>&1`)).exitCode === 0;

  // Positive control: the same probe works against the container's own app, so a failure below means "no route".
  assert.equal(await reach(b.container_id!, `http://${ipB}:8080/healthz`), true, 'probe tool works inside the network');

  // Second match: A cannot reach B's IP.
  assert.equal(await reach(a.container_id!, `http://${ipB}:8080/healthz`), false, 'A must not reach B');

  // Host: default gateway and every non-loopback host address, on a port where the host really listens.
  const gw = (await sh(a.container_id!, "ip route | awk '/default/ {print $3}'")).output.trim();
  const targets = new Set<string>(['10.0.2.2', '169.254.1.2', 'host.containers.internal']);
  if (gw) targets.add(gw);
  const { networkInterfaces } = await import('node:os');
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) targets.add(i.address);
  for (const t of Array.from(targets)) assert.equal(await reach(a.container_id!, `http://${t}:${hostPort}/`), false, `container must not reach host via ${t}`);

  // Internet: raw IP and DNS name.
  assert.equal(await reach(a.container_id!, 'http://1.1.1.1/'), false, 'no route to public IP');
  assert.equal(await reach(a.container_id!, 'http://example.com/'), false, 'no DNS/internet');
});

test('stop destroys container and network; timeout and kill paths are audited', { timeout: 300_000 }, async () => {
  const a = dbm.getActiveRangeMatch(A)!;
  const b = dbm.getActiveRangeMatch(B)!;

  // Kill A as an operator.
  assert.equal(await orch.stopMatch(A, { reason: 'KILLED', userId: 'user_op_001' }), true);
  assert.equal(await dock.inspectContainer(a.container_id!), null, 'container gone');
  assert.equal(await dock.inspectNetwork(a.network_id!), null, 'network gone');
  assert.equal(dbm.getRangeMatchById(a.id)?.status, 'KILLED');
  assert.equal(await orch.stopMatch(A), false, 'second stop is a no-op');

  // Normal stop of B.
  assert.equal(await orch.stopMatch(B), true);
  assert.equal(await dock.inspectContainer(b.container_id!), null);
  assert.equal(await dock.inspectNetwork(b.network_id!), null);
  assert.equal(dbm.getRangeMatchById(b.id)?.status, 'ENDED');
  assert.ok(dbm.getRangeMatchById(b.id)?.ended_at);

  const logs = dbm.openLocalDatabase().prepare('SELECT user_id, action, details FROM audit_logs ORDER BY rowid').all() as Array<{ user_id: string; action: string; details: string }>;
  const actions = logs.map((l) => l.action);
  for (const want of ['RANGE_MATCH_STARTED', 'RANGE_MATCH_KILLED', 'RANGE_MATCH_ENDED', 'RANGE_CONTAINER_LOG']) assert.ok(actions.includes(want), `audit has ${want}`);
  assert.ok(logs.some((l) => l.action === 'RANGE_MATCH_KILLED' && l.user_id === 'user_op_001'), 'kill records operator id');
  assert.ok(logs.some((l) => l.action === 'RANGE_CONTAINER_LOG' && l.details.includes(a.id) && /ACCESS GET \/(healthz|internal\/admin\/vault)/.test(l.details)), 'target access log captured');

  const left = await dock.listByLabel(orch.RANGE_LABEL);
  assert.deepEqual(left, { containers: [], networks: [] });
});

test('a match past its timeout is force-destroyed automatically', { timeout: 300_000 }, async () => {
  const T = `${unique}_t`;
  const row = await orch.startMatch(T, { timeoutMs: 4000 });
  // The database transition happens before asynchronous Docker cleanup.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (dbm.getRangeMatchById(row.id)?.status === 'TIMEOUT'
      && await dock.inspectContainer(row.container_id!) === null
      && await dock.inspectNetwork(row.network_id!) === null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(dbm.getRangeMatchById(row.id)?.status, 'TIMEOUT');
  assert.equal(await dock.inspectContainer(row.container_id!), null);
  assert.equal(await dock.inspectNetwork(row.network_id!), null);
  const n = dbm.openLocalDatabase().prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'RANGE_MATCH_TIMEOUT'").get() as { n: number };
  assert.equal(n.n, 1);
});

test('kill route is operator-only', () => {
  const src = fs.readFileSync('src/app/api/range/admin/kill/route.ts', 'utf8');
  assert.match(src, /const user = await getZipiOperator\(\);\s*if \(!user\)/);
  assert.match(src, /status: 403/);
  assert.ok(src.indexOf('if (!user)') < src.indexOf('await stopMatch('), 'authz before any destroy');
});
