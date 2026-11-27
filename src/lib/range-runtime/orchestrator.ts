// Match orchestrator: one hardened, ephemeral target container per match on its own internal network.
// Only this module (via dockerClient) talks to Docker.
import path from 'node:path';
import * as docker from './dockerClient';
import {
  createRangeMatch,
  getActiveRangeMatch,
  updateRangeMatch,
  endRangeMatch,
  recordLocalAuditLog as recordAuditLog,
  type RangeMatchRow,
} from '@/lib/db';

export const RANGE_LABEL = 'cynchor.range';
export const IMAGE_TAG = 'cynchor-range-target:1';
export const LIMITS = { memoryBytes: 256 * 1024 * 1024, nanoCpus: 500_000_000, pids: 128 } as const;
export const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;
const LOG_POLL_MS = 5000;
const TARGET_DIR = path.join(process.cwd(), 'range-target');

type Live = { timeout: NodeJS.Timeout; logTimer: NodeJS.Timeout; cursor: string; containerId: string; networkId: string };
// Shared across route bundles (like the scorer state) so the reaper sees every live match.
const lg = globalThis as unknown as { __rangeLive?: Map<string, Live> };
const live: Map<string, Live> = (lg.__rangeLive ??= new Map());
let imageReady: Promise<void> | null = null;

function ensureImage(): Promise<void> {
  // Built once per process; layer caching makes repeat builds cheap and keeps the image in step with range-target/.
  imageReady ??= docker.buildImage(TARGET_DIR, IMAGE_TAG).catch((e) => {
    imageReady = null;
    throw e;
  });
  return imageReady;
}

async function waitHealthy(containerId: string, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await docker.execInContainer(containerId, ['wget', '-q', '-O', '-', 'http://127.0.0.1:8080/healthz']);
      if (r.exitCode === 0 && r.output.includes('"ok":true')) return;
    } catch {
      // container still starting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('target did not become healthy');
}

// Rootless cgroup delegation may silently ignore limits, so compare what the container actually sees.
async function verifyLimits(rangeId: string, containerId: string): Promise<string[]> {
  const warnings: string[] = [];
  const info = await docker.inspectContainer(containerId);
  const hc = info?.HostConfig ?? {};
  if (hc.Memory !== LIMITS.memoryBytes) warnings.push(`memory limit not applied in HostConfig (got ${hc.Memory})`);
  if (hc.PidsLimit !== LIMITS.pids) warnings.push(`pids limit not applied in HostConfig (got ${hc.PidsLimit})`);
  if (hc.NanoCpus !== LIMITS.nanoCpus && hc.NanoCpus !== undefined && !hc.CpuQuota) warnings.push(`cpu limit not applied in HostConfig (got ${hc.NanoCpus})`);
  try {
    const r = await docker.execInContainer(containerId, ['sh', '-c', 'cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/cpu.max']);
    const [mem, pids, cpu] = r.output.trim().split('\n');
    if (String(LIMITS.memoryBytes) !== mem) warnings.push(`cgroup memory.max is ${mem}, expected ${LIMITS.memoryBytes}`);
    if (String(LIMITS.pids) !== pids) warnings.push(`cgroup pids.max is ${pids}, expected ${LIMITS.pids}`);
    if (!cpu || !cpu.startsWith('50000 ')) warnings.push(`cgroup cpu.max is ${cpu}, expected 50000 100000`);
  } catch (e) {
    warnings.push(`could not read cgroup limits inside container: ${(e as Error).message}`);
  }
  for (const w of warnings) {
    console.warn(`[range] ${rangeId}: ${w}`);
    recordAuditLog({ action: 'RANGE_LIMIT_WARNING', details: `range match ${rangeId}: ${w}` });
  }
  return warnings;
}

async function pumpLogs(rangeId: string): Promise<void> {
  const l = live.get(rangeId);
  if (!l) return;
  try {
    const lines = await docker.getContainerLogs(l.containerId, Math.floor(Date.parse(l.cursor.split(' ')[0]) / 1000) || 0);
    const fresh = lines.filter((line) => line.split(' ')[0] > l.cursor);
    if (fresh.length === 0) return;
    l.cursor = fresh[fresh.length - 1].split(' ')[0];
    for (let i = 0; i < fresh.length; i += 20) {
      recordAuditLog({ action: 'RANGE_CONTAINER_LOG', details: `range match ${rangeId}\n${fresh.slice(i, i + 20).join('\n').slice(0, 3500)}` });
    }
  } catch {
    // container may be gone; teardown handles it
  }
}

async function teardown(containerId: string | null, networkId: string | null): Promise<void> {
  if (containerId) {
    await docker.stopContainer(containerId, 2).catch(() => {});
    await docker.removeContainer(containerId).catch(() => {});
  }
  if (networkId) await docker.removeNetwork(networkId).catch(() => {});
}

async function destroy(row: RangeMatchRow, finalStatus: 'ENDED' | 'TIMEOUT' | 'KILLED' | 'FAILED', userId?: string, details?: string): Promise<boolean> {
  const l = live.get(row.id);
  if (l) {
    clearTimeout(l.timeout);
    clearInterval(l.logTimer);
    await pumpLogs(row.id); // final flush before the container disappears
    live.delete(row.id);
  }
  // Claim the transition first so only one caller (stop, kill, timeout) records it.
  const claimed = endRangeMatch(row.id, finalStatus, userId, details);
  await teardown(row.container_id ?? l?.containerId ?? null, row.network_id ?? l?.networkId ?? null);
  return claimed;
}

export async function startMatch(matchId: string, opts: { userId?: string; timeoutMs?: number } = {}): Promise<RangeMatchRow> {
  if (getActiveRangeMatch(matchId)) throw new Error(`match ${matchId} already has a running range target`);
  if (!(await docker.ping())) throw new Error('Docker engine is not reachable');
  await ensureImage();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Re-check with no await before the insert: ping and the image build above let a concurrent caller get here first.
  if (getActiveRangeMatch(matchId)) throw new Error(`match ${matchId} already has a running range target`);
  const row = createRangeMatch(matchId, new Date(Date.now() + timeoutMs).toISOString(), opts.userId);
  const short = row.id.slice(4, 16);
  const labels = { [RANGE_LABEL]: '1', 'cynchor.range.match': row.id };
  let networkId: string | null = null;
  let containerId: string | null = null;
  try {
    networkId = await docker.createNetwork(`range-net-${short}`, labels);
    updateRangeMatch(row.id, { network_id: networkId });
    containerId = await docker.createContainer(`range-target-${short}`, {
      Image: IMAGE_TAG,
      User: 'node',
      Env: ['RANGE_DB_PATH=/data/range.sqlite'],
      Labels: labels,
      ExposedPorts: {},
      HostConfig: {
        NetworkMode: `range-net-${short}`,
        PortBindings: {},
        PublishAllPorts: false,
        ReadonlyRootfs: true,
        Tmpfs: {
          '/app': 'rw,exec,nosuid,nodev,size=64m,mode=1777',
          '/tmp': 'rw,noexec,nosuid,nodev,size=16m,mode=1777',
          // Target DB lives here so a patch restart reopens it (RAM only, container-local, not patchable code).
          '/data': 'rw,noexec,nosuid,nodev,size=16m,mode=1777',
        },
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        Privileged: false,
        Memory: LIMITS.memoryBytes,
        MemorySwap: LIMITS.memoryBytes,
        NanoCpus: LIMITS.nanoCpus,
        PidsLimit: LIMITS.pids,
        RestartPolicy: { Name: 'no' },
      },
      NetworkingConfig: { EndpointsConfig: { [`range-net-${short}`]: {} } },
    });
    updateRangeMatch(row.id, { container_id: containerId });
    await docker.startContainer(containerId);
    await waitHealthy(containerId);
  } catch (e) {
    await destroy({ ...row, container_id: containerId, network_id: networkId }, 'FAILED', opts.userId, (e as Error).message);
    throw e;
  }
  updateRangeMatch(row.id, { status: 'RUNNING' });
  await verifyLimits(row.id, containerId);

  const timeout = setTimeout(() => {
    void stopMatch(matchId, { reason: 'TIMEOUT', details: `exceeded ${timeoutMs}ms` }).catch((err) => console.error('[range] timeout teardown failed', err));
  }, timeoutMs);
  const logTimer = setInterval(() => void pumpLogs(row.id), LOG_POLL_MS);
  timeout.unref();
  logTimer.unref();
  live.set(row.id, { timeout, logTimer, cursor: '', containerId, networkId });
  return { ...row, container_id: containerId, network_id: networkId, status: 'RUNNING' };
}

export async function stopMatch(
  matchId: string,
  opts: { userId?: string; reason?: 'ENDED' | 'TIMEOUT' | 'KILLED'; details?: string } = {},
): Promise<boolean> {
  const row = getActiveRangeMatch(matchId);
  if (!row) return false;
  const reason = opts.reason ?? 'ENDED';
  const who = opts.userId ? ` by operator ${opts.userId}` : '';
  return destroy(row, reason, opts.userId, opts.details ?? `${reason.toLowerCase()}${who}`);
}

// True while this process owns the timers for the match row (row id, not match session id).
export function isLive(rowId: string): boolean {
  return live.has(rowId);
}
// Reaper entry point: destroys the container and network of a row this process no longer drives and ends the row once.
export function reapMatch(row: RangeMatchRow, reason: 'TIMEOUT' | 'KILLED'): Promise<boolean> {
  return destroy(row, reason, undefined, reason === 'TIMEOUT' ? 'reaped: timeout_at passed' : 'reaped: server restarted');
}
export { listByLabel } from './dockerClient';
