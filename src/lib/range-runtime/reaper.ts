// Reaper: ENDS (never resumes) range matches this process no longer drives, and removes orphan labelled Docker objects.
// Scorer and orchestrator state is in-process, so after a restart a match cannot be resumed faithfully.
import { getDb, type RangeMatchRow } from '@/lib/db';
import { RANGE_LABEL, isLive, reapMatch } from './orchestrator';
import { reconcileEndedMatches } from './scorer';
import * as docker from './dockerClient';
export const REAPER_INTERVAL_MS = 60_000;
export const REAPER_GRACE_MS = 30_000; // startMatch inserts the row before the container exists
export type ReaperDeps = {
  isLive?: (rowId: string) => boolean;
  reapMatch?: (row: RangeMatchRow, reason: 'TIMEOUT' | 'KILLED') => Promise<boolean>;
  reconcile?: () => Promise<number>;
  listByLabel?: (label: string) => Promise<{ containers: string[]; networks: string[] }>;
  removeContainer?: (id: string) => Promise<void>;
  removeNetwork?: (id: string) => Promise<void>;
  now?: () => number;
};
export type ReapResult = { matchesEnded: number; containersRemoved: number; networksRemoved: number };
const activeRows = () => getDb().prepare("SELECT * FROM range_target_matches WHERE status IN ('STARTING','RUNNING')").all() as unknown as RangeMatchRow[];
export async function reapOrphans(deps: ReaperDeps = {}): Promise<ReapResult> {
  const live = deps.isLive ?? isLive;
  const now = (deps.now ?? Date.now)();
  const result: ReapResult = { matchesEnded: 0, containersRemoved: 0, networksRemoved: 0 };
  for (const row of activeRows()) {
    if (now - Date.parse(row.started_at) < REAPER_GRACE_MS) continue;
    const overdue = Date.parse(row.timeout_at) <= now;
    if (live(row.id) && !overdue) continue;
    if (await (deps.reapMatch ?? reapMatch)(row, overdue ? 'TIMEOUT' : 'KILLED').catch((e) => { console.error(`[range] reap failed for ${row.id}`, e); return false; })) result.matchesEnded++;
  }
  // Frees the teams and writes the After Action Report for the rows ended above.
  await (deps.reconcile ?? (() => reconcileEndedMatches()))().catch((e) => console.error('[range] reaper reconcile failed', e));
  // Orphan Docker objects: labelled, but not owned by any active row. A row still inside the grace window may be
  // mid-creation, so the sweep waits for the next round in that case.
  const remaining = activeRows();
  if (remaining.some((r) => now - Date.parse(r.started_at) < REAPER_GRACE_MS)) return result;
  const owned = new Set<string>();
  for (const r of remaining) {
    if (r.container_id) owned.add(r.container_id);
    if (r.network_id) owned.add(r.network_id);
  }
  const found = await (deps.listByLabel ?? docker.listByLabel)(RANGE_LABEL).catch(() => null);
  if (found === null) return result;
  for (const id of found.containers.filter((c) => !owned.has(c))) {
    await docker.stopContainer(id, 2).catch(() => {});
    if (await (deps.removeContainer ?? docker.removeContainer)(id).then(() => true, () => false)) result.containersRemoved++;
  }
  for (const id of found.networks.filter((n) => !owned.has(n))) {
    if (await (deps.removeNetwork ?? docker.removeNetwork)(id).then(() => true, () => false)) result.networksRemoved++;
  }
  return result;
}
type ReaperGlobal = { timer?: NodeJS.Timeout };
const g = globalThis as unknown as { __rangeReaper?: ReaperGlobal };
const reaper: ReaperGlobal = (g.__rangeReaper ??= {});
// Idempotent. The first call sweeps immediately (startup), then every 60 s.
export function ensureReaperRunning(): void {
  if (reaper.timer !== undefined) return;
  const run = () => void reapOrphans().catch((e) => console.error('[range] reaper failed', e));
  reaper.timer = setInterval(run, REAPER_INTERVAL_MS);
  reaper.timer.unref();
  run();
}
