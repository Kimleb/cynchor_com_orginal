// Reaches the target inside its match container. The match network is internal and publishes no port, so the host
// cannot open a socket to the container; requests run through the engine's exec API (node inside the container).
import { execInContainer } from './dockerClient';
import type { TargetResponse, Transport } from './exploitChecks';
const MAX_BODY = 256 * 1024;
const REQUEST_SCRIPT = `
const http = require('http');
const o = JSON.parse(process.argv[1]);
const headers = { ...(o.cookie ? { cookie: o.cookie } : {}) };
let data = null;
if (o.body !== undefined) { data = Buffer.from(typeof o.body === 'string' ? o.body : JSON.stringify(o.body)); headers['content-type'] = o.contentType || 'application/json'; headers['content-length'] = data.length; }
const req = http.request({ host: '127.0.0.1', port: 8080, method: o.method, path: o.path, headers, timeout: 4000 }, (res) => {
  const chunks = []; let n = 0;
  res.on('data', (c) => { if (n < ${MAX_BODY}) { chunks.push(c); n += c.length; } });
  res.on('end', () => console.log(JSON.stringify({ status: res.statusCode, contentType: res.headers['content-type'] || '', setCookie: res.headers['set-cookie'] || [], body: Buffer.concat(chunks).toString('utf8').slice(0, ${MAX_BODY}) })));
});
req.on('timeout', () => req.destroy(new Error('timeout')));
req.on('error', (e) => { console.log(JSON.stringify({ error: String(e.message) })); });
if (data) req.write(data);
req.end();
`;
export type ProxyRequest = { method: 'GET' | 'POST'; path: string; body?: unknown; cookie?: string };
export type ProxyResult = { status: number; contentType: string; body: string; setCookie: string[] };
export async function requestTarget(containerId: string, req: ProxyRequest): Promise<ProxyResult> {
  const r = await execInContainer(containerId, ['node', '-e', REQUEST_SCRIPT, JSON.stringify(req)]);
  const line = r.output.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
  if (!line) throw new Error('no response from target');
  const parsed = JSON.parse(line);
  if (parsed.error) throw new Error(`target request failed: ${parsed.error}`);
  return { status: parsed.status, contentType: parsed.contentType, body: parsed.body, setCookie: parsed.setCookie };
}
export function containerTransport(containerId: string): Transport {
  return async (method, path, body, cookie): Promise<TargetResponse> => {
    const r = await requestTarget(containerId, { method, path, body, cookie });
    let json: any = null;
    try { json = JSON.parse(r.body); } catch { /* not JSON */ }
    return { status: r.status, json, text: r.body, cookie: (r.setCookie[0] || '').split(';')[0] };
  };
}
// Files Blue may replace. Anything else is refused before it reaches the container.
export const PATCHABLE_FILES = ['server.js', 'db.js'] as const;
export type PatchableFile = (typeof PATCHABLE_FILES)[number];
export const MAX_PATCH_BYTES = 64 * 1024;
const PATCH_SCRIPT = `
const fs = require('fs'); const cp = require('child_process');
const [file, content] = process.argv.slice(1);
const tmp = '/tmp/patch-' + process.pid + '.js';
fs.writeFileSync(tmp, content);
const chk = cp.spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
fs.unlinkSync(tmp);
if (chk.status !== 0) { console.log(JSON.stringify({ ok: false, error: String(chk.stderr).split('\\n').slice(0, 6).join('\\n') })); process.exit(0); }
fs.writeFileSync('/app/' + file, content);
// The entrypoint loop restarts node when it exits: signal the running server.
let killed = 0;
for (const pid of fs.readdirSync('/proc').filter((p) => /^[0-9]+$/.test(p))) {
  try { if (fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').startsWith('node\\0server.js\\0')) { process.kill(Number(pid), 'SIGTERM'); killed++; } } catch {}
}
console.log(JSON.stringify({ ok: true, restarted: killed }));
`;
export async function patchTargetFile(containerId: string, file: PatchableFile, content: string): Promise<{ ok: boolean; error?: string }> {
  const r = await execInContainer(containerId, ['node', '-e', PATCH_SCRIPT, file, content]);
  const line = r.output.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
  if (!line) throw new Error('patch command gave no result');
  const parsed = JSON.parse(line);
  if (parsed.ok && parsed.restarted === 0) return { ok: false, error: 'target process not found to restart' };
  return parsed.ok ? { ok: true } : { ok: false, error: String(parsed.error).slice(0, 500) };
}
