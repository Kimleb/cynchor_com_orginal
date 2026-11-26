import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
// A fake engine on a unix socket that accepts requests and never answers must not hang the client.
test('docker client rejects a request the engine never answers instead of hanging', async () => {
  const sock = path.join(os.tmpdir(), `docker-hang-${process.pid}.sock`);
  fs.rmSync(sock, { force: true });
  const server = http.createServer(() => { /* never respond */ });
  await new Promise<void>((r) => server.listen(sock, r));
  process.env.DOCKER_HOST = `unix://${sock}`;
  process.env.RANGE_DOCKER_TIMEOUT_MS = '300';
  try {
    const docker = await import('../src/lib/range-runtime/dockerClient');
    const t0 = Date.now();
    await assert.rejects(docker.inspectContainer('abc'), /timed out after 300ms/);
    assert.ok(Date.now() - t0 < 5000);
    assert.equal(await docker.ping(), false, 'ping reports an unresponsive engine as down');
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(sock, { force: true });
  }
});
