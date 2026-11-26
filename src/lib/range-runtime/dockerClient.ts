// Thin Docker Engine API client over Node's built-in http/https. The only module that talks to Docker.
// Works against Docker or rootless Podman's Docker-compatible API. No dockerode dependency.
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';

const API_VERSION = 'v1.41';

type Endpoint = { socketPath: string } | { host: string; port: number; tls: boolean };

function parseDockerHost(): Endpoint {
  const raw = process.env.DOCKER_HOST;
  if (raw) {
    if (raw.startsWith('unix://')) return { socketPath: raw.slice('unix://'.length) };
    const m = /^(tcp|http|https):\/\/([^:/]+)(?::(\d+))?/.exec(raw);
    if (m) {
      const tls = m[1] === 'https';
      return { host: m[2], port: m[3] ? Number(m[3]) : tls ? 2376 : 2375, tls };
    }
    throw new Error(`Unsupported DOCKER_HOST: ${raw}`);
  }
  return { socketPath: '/var/run/docker.sock' };
}

const endpoint = parseDockerHost();

export class DockerError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Raw = { status: number; body: Buffer };

function request(method: string, path: string, body?: unknown | Buffer, headers: Record<string, string> = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const isBuf = Buffer.isBuffer(body);
    const payload = body === undefined ? undefined : isBuf ? (body as Buffer) : Buffer.from(JSON.stringify(body));
    const h: Record<string, string | number> = { ...headers };
    if (payload) {
      h['Content-Length'] = payload.length;
      if (!h['Content-Type']) h['Content-Type'] = 'application/json';
    }
    const opts = { method, path: `/${API_VERSION}${path}`, headers: h, ...('socketPath' in endpoint ? { socketPath: endpoint.socketPath } : { host: endpoint.host, port: endpoint.port }) };
    const lib = 'tls' in endpoint && endpoint.tls ? https : http;
    const req = lib.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function json<T>(method: string, path: string, body?: unknown, okStatuses: number[] = [200, 201, 204]): Promise<T> {
  const r = await request(method, path, body);
  if (!okStatuses.includes(r.status)) throw new DockerError(r.status, `${method} ${path} -> ${r.status}: ${r.body.toString().slice(0, 300)}`);
  const text = r.body.toString();
  return (text ? JSON.parse(text) : {}) as T;
}

// Splits Docker's multiplexed stdout/stderr stream (8-byte frame headers) into text.
export function demux(buf: Buffer): string {
  let off = 0;
  let out = '';
  while (off + 8 <= buf.length) {
    const size = buf.readUInt32BE(off + 4);
    out += buf.subarray(off + 8, off + 8 + size).toString('utf8');
    off += 8 + size;
  }
  return out;
}

export async function ping(): Promise<boolean> {
  try {
    return (await request('GET', '/_ping')).status === 200;
  } catch {
    return false;
  }
}

export async function imageExists(name: string): Promise<boolean> {
  return (await request('GET', `/images/${encodeURIComponent(name)}/json`)).status === 200;
}

// Builds an image from a directory by tarring it (node_modules excluded) and POSTing to /build.
export async function buildImage(contextDir: string, tag: string): Promise<void> {
  const tar = await new Promise<Buffer>((resolve, reject) => {
    const p = spawn('tar', ['-C', contextDir, '--exclude=node_modules', '-cf', '-', '.']);
    const chunks: Buffer[] = [];
    p.stdout.on('data', (c: Buffer) => chunks.push(c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`tar exited ${code}`))));
  });
  const r = await request('POST', `/build?t=${encodeURIComponent(tag)}&rm=1&forcerm=1`, tar, { 'Content-Type': 'application/x-tar' });
  const text = r.body.toString();
  if (r.status !== 200 || /"error"\s*:/.test(text)) throw new DockerError(r.status, `image build failed: ${text.slice(-500)}`);
}

export async function createNetwork(name: string, labels: Record<string, string>): Promise<string> {
  const r = await json<{ Id: string }>('POST', '/networks/create', { Name: name, Driver: 'bridge', Internal: true, Labels: labels });
  return r.Id;
}

export async function removeNetwork(id: string): Promise<void> {
  const r = await request('DELETE', `/networks/${encodeURIComponent(id)}`);
  if (![200, 204, 404].includes(r.status)) throw new DockerError(r.status, `remove network -> ${r.status}: ${r.body.toString().slice(0, 200)}`);
}

export async function inspectNetwork(id: string): Promise<{ Id: string; Internal: boolean; Containers?: Record<string, unknown> } | null> {
  const r = await request('GET', `/networks/${encodeURIComponent(id)}`);
  return r.status === 200 ? JSON.parse(r.body.toString()) : null;
}

export async function createContainer(name: string, config: Record<string, unknown>): Promise<string> {
  const r = await json<{ Id: string }>('POST', `/containers/create?name=${encodeURIComponent(name)}`, config);
  return r.Id;
}

export async function startContainer(id: string): Promise<void> {
  const r = await request('POST', `/containers/${id}/start`);
  if (![204, 304].includes(r.status)) throw new DockerError(r.status, `start -> ${r.status}: ${r.body.toString().slice(0, 300)}`);
}

export async function stopContainer(id: string, timeoutSec = 3): Promise<void> {
  const r = await request('POST', `/containers/${id}/stop?t=${timeoutSec}`);
  if (![204, 304, 404].includes(r.status)) throw new DockerError(r.status, `stop -> ${r.status}: ${r.body.toString().slice(0, 300)}`);
}

export async function removeContainer(id: string): Promise<void> {
  const r = await request('DELETE', `/containers/${id}?force=1&v=1`);
  if (![200, 204, 404].includes(r.status)) throw new DockerError(r.status, `remove -> ${r.status}: ${r.body.toString().slice(0, 300)}`);
}

export type ContainerInfo = {
  Id: string;
  State: { Status: string; Running: boolean; ExitCode: number };
  HostConfig: Record<string, any>;
  NetworkSettings: { Ports?: Record<string, unknown> | null; Networks: Record<string, { IPAddress: string }> };
  Config: { User: string };
};

export async function inspectContainer(id: string): Promise<ContainerInfo | null> {
  const r = await request('GET', `/containers/${id}/json`);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new DockerError(r.status, `inspect -> ${r.status}`);
  return JSON.parse(r.body.toString());
}

export async function getContainerStats(id: string): Promise<any> {
  return json<any>('GET', `/containers/${id}/stats?stream=false&one-shot=true`);
}

// Returns timestamped log lines (stdout+stderr), optionally only those since a unix time in seconds.
export async function getContainerLogs(id: string, sinceSec = 0): Promise<string[]> {
  const r = await request('GET', `/containers/${id}/logs?stdout=1&stderr=1&timestamps=1&since=${sinceSec}`);
  if (r.status !== 200) throw new DockerError(r.status, `logs -> ${r.status}`);
  const text = demux(r.body);
  // Podman may return unframed text when no TTY header is present.
  const out = text.length === 0 && r.body.length > 0 ? r.body.toString('utf8') : text;
  return out.split('\n').filter((l) => l.length > 0);
}

export async function execInContainer(id: string, cmd: string[]): Promise<{ exitCode: number; output: string }> {
  const created = await json<{ Id: string }>('POST', `/containers/${id}/exec`, { Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false });
  const r = await request('POST', `/exec/${created.Id}/start`, { Detach: false, Tty: false });
  if (r.status !== 200) throw new DockerError(r.status, `exec start -> ${r.status}: ${r.body.toString().slice(0, 200)}`);
  const info = await json<{ ExitCode: number }>('GET', `/exec/${created.Id}/json`);
  return { exitCode: info.ExitCode, output: demux(r.body) };
}

export async function listByLabel(label: string): Promise<{ containers: string[]; networks: string[] }> {
  const f = encodeURIComponent(JSON.stringify({ label: [label] }));
  const c = await json<Array<{ Id: string }>>('GET', `/containers/json?all=1&filters=${f}`);
  const n = await json<Array<{ Id: string }>>('GET', `/networks?filters=${f}`);
  return { containers: c.map((x) => x.Id), networks: n.map((x) => x.Id) };
}
