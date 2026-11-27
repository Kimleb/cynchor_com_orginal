// Creates an orphan labelled container + network (no DB row), runs reapOrphans, shows them gone.
process.env.CYNCHOR_DB_PATH = '.test.sqlite.reaperproof';
process.env.IP_HASH_SALT ??= 'proof-salt';
import fs from 'node:fs';
for (const f of ['', '-wal', '-shm']) fs.rmSync(`.test.sqlite.reaperproof${f}`, { force: true });
(async () => {
  const docker = await import('../../../../src/lib/range-runtime/dockerClient');
  const { reapOrphans } = await import('../../../../src/lib/range-runtime/reaper');
  const { RANGE_LABEL } = await import('../../../../src/lib/range-runtime/orchestrator');
const labels = { [RANGE_LABEL]: '1', 'cynchor.range.match': 'orphan-proof' };
const net = await docker.createNetwork('range-net-orphanproof', labels);
const ctr = await docker.createContainer('range-target-orphanproof', { Image: 'node:22-alpine', Cmd: ['sleep', '300'], Labels: labels, HostConfig: { NetworkMode: net } });
await docker.startContainer(ctr);
console.log('before:', JSON.stringify(await docker.listByLabel(RANGE_LABEL)));
console.log('reap result:', JSON.stringify(await reapOrphans()));
console.log('after:', JSON.stringify(await docker.listByLabel(RANGE_LABEL)));

})().catch((e) => { console.error(e); process.exit(1); });
