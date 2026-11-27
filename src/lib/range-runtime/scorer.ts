// Scores live matches from real HTTP probes against each match's container. Nothing here fakes a value:
// the vault balance is read off the target and exploit status comes from the shared exploit checks.
import { openLocalDatabase as getDb, getActiveRangeMatch, updateRangeMatch, getRangeMatch } from '@/lib/db';
import { stopMatch } from './orchestrator';
import { ensureReaperRunning } from './reaper';
import { VAULT_START_CENTS } from './reports';
import { containerTransport } from './targetHttp';
import { CHECKS, EXPLOIT_IDS, EXPLOIT_PATHS, checkHealth, readVaultBalance, type ExploitId, type Transport } from './exploitChecks';
import { endRangeSession, recordRangeEvent, type EndReason, type StopFn } from './lobby';
export const SCORE_INTERVAL_MS = 5000;
type MatchScore = { checks: Map<ExploitId, boolean>; credited: Set<string>; cursor: number; resetLogged: boolean };
type ScorerGlobal = { timer?: NodeJS.Timeout; state: Map<string, MatchScore>; busy: Set<string> };
// Shared across route bundles so every route sees the same timer and state.
const g = globalThis as unknown as { __rangeScorer?: ScorerGlobal };
const scorer: ScorerGlobal = (g.__rangeScorer ??= { state: new Map(), busy: new Set() });
export type TickDeps = { transport?: (containerId: string) => Transport; stop?: StopFn };
export type TickResult =
  | { status: 'inactive' }
  | { status: 'unhealthy' }
  | { status: 'ended'; reason: EndReason }
  | { status: 'scored'; vault: number | null; landed: ExploitId[]; blocked: ExploitId[] };
const defaultStop: StopFn = (id, o) => stopMatch(id, o);
type ProxyRow = { rowid: number; user_id: string; details: string };
function newProxyRows(sessionId: string, after: number): ProxyRow[] {
  return getDb().prepare(`
    SELECT rowid AS rowid, user_id, details FROM audit_logs
    WHERE action = 'RANGE_PROXY_REQUEST' AND rowid > ? AND instr(details, ?) = 1 ORDER BY rowid ASC LIMIT 500
  `).all(after, `[range:${sessionId}:RED]`) as unknown as ProxyRow[];
}
function latestPatcher(sessionId: string): string | undefined {
  const r = getDb().prepare("SELECT user_id FROM audit_logs WHERE action = 'RANGE_PATCH_APPLIED' AND instr(details, ?) = 1 ORDER BY rowid DESC LIMIT 1")
    .get(`[range:${sessionId}:BLUE]`) as { user_id: string } | undefined;
  return r?.user_id;
}
// Proxy rows are logged as "[tag] METHOD /path -> status".
function parseProxy(details: string): { req: string; status: number } | null {
  const m = /\] (GET|POST) (\S+) -> (\d{3})/.exec(details);
  return m ? { req: `${m[1]} ${m[2]}`, status: Number(m[3]) } : null;
}
export async function scoreTick(sessionId: string, deps: TickDeps = {}): Promise<TickResult> {
  const stop = deps.stop ?? defaultStop;
  const rtm = getActiveRangeMatch(sessionId);
  if (rtm === undefined || rtm.status !== 'RUNNING' || rtm.container_id === null) return { status: 'inactive' };
  if (Date.parse(rtm.timeout_at) <= Date.now()) {
    await endRangeSession(sessionId, 'timeout', stop);
    scorer.state.delete(sessionId);
    return { status: 'ended', reason: 'timeout' };
  }
  const t = (deps.transport ?? containerTransport)(rtm.container_id);
  // A target that is down or restarting is not "blocked": skip the tick.
  if (!(await checkHealth(t).catch(() => false))) return { status: 'unhealthy' };
  const state = scorer.state.get(sessionId) ?? { checks: new Map<ExploitId, boolean>(), credited: new Set<string>(), cursor: 0, resetLogged: false };
  scorer.state.set(sessionId, state);
  let vault = await readVaultBalance(t).catch(() => null);
  if (vault !== null) {
    // Monotonic floor: the vault only drains. A read above the stored floor means Blue's patched code reset the
    // target's data, so the floor (persisted in range_target_matches) wins and the reset is audited once.
    const floor = rtm.vault_balance_cents ?? VAULT_START_CENTS;
    if (vault > floor) {
      if (!state.resetLogged) {
        state.resetLogged = true;
        recordRangeEvent({ matchId: sessionId, scope: 'ALL', action: 'RANGE_VAULT_RESET_DETECTED', details: `vault read ${vault} above floor ${floor}; floor kept` });
      }
      vault = floor;
    } else {
      state.resetLogged = false;
      updateRangeMatch(rtm.id, { vault_balance_cents: vault });
    }
  }
  const rows = newProxyRows(sessionId, state.cursor);
  if (rows.length > 0) state.cursor = rows[rows.length - 1].rowid;
  if (vault === 0) {
    // Boss exploit: credit the Red player whose last proxied request went to the vault endpoint.
    const sweeper = [...rows].reverse().find((r) => /\] POST \/internal\/admin\/vault /.test(r.details));
    recordRangeEvent({ matchId: sessionId, scope: 'ALL', action: 'RANGE_EXPLOIT_LANDED', userId: sweeper?.user_id, details: 'exploit=vault-sweep probe: vault balance read 0 from target' });
    await endRangeSession(sessionId, 'vault-zero', stop);
    scorer.state.delete(sessionId);
    return { status: 'ended', reason: 'vault-zero' };
  }
  const landed: ExploitId[] = [];
  const blocked: ExploitId[] = [];
  for (const id of EXPLOIT_IDS) {
    let result;
    try {
      result = await CHECKS[id](t);
    } catch {
      continue; // target flapped mid-probe: leave the previous state alone
    }
    const prev = state.checks.get(id);
    state.checks.set(id, result.landed);
    if (result.landed) {
      landed.push(id);
      // A player is credited once per exploit, when a proxied request of theirs hit it while the probe confirms it is open.
      for (const row of rows) {
        const p = parseProxy(row.details);
        const key = `${row.user_id}:${id}`;
        if (p === null || p.status >= 300 || state.credited.has(key) || !EXPLOIT_PATHS[id].test(p.req)) continue;
        state.credited.add(key);
        recordRangeEvent({ matchId: sessionId, scope: 'ALL', action: 'RANGE_EXPLOIT_LANDED', userId: row.user_id, details: `exploit=${id} probe: ${result.detail}` });
      }
    } else {
      blocked.push(id);
      if (prev !== false) {
        recordRangeEvent({ matchId: sessionId, scope: 'ALL', action: 'RANGE_EXPLOIT_BLOCKED', userId: prev === true ? latestPatcher(sessionId) : undefined, details: `exploit=${id} probe: ${result.detail}` });
      }
    }
  }
  return { status: 'scored', vault, landed, blocked };
}
const TERMINAL_REASON: Record<string, EndReason> = { ENDED: 'ended', TIMEOUT: 'timeout', KILLED: 'killed', FAILED: 'ended' };
// Timeouts and operator kills end the container through the orchestrator; this frees the teams and writes the summary.
export async function reconcileEndedMatches(stop: StopFn = defaultStop): Promise<number> {
  const open = getDb().prepare("SELECT id FROM match_sessions WHERE mode = 'RANGE' AND status = 'ACTIVE'").all() as Array<{ id: string }>;
  let n = 0;
  for (const s of open) {
    const rtm = getRangeMatch(s.id);
    if (rtm === undefined || rtm.status === 'STARTING' || rtm.status === 'RUNNING') continue;
    if (await endRangeSession(s.id, TERMINAL_REASON[rtm.status] ?? 'ended', stop)) n++;
    scorer.state.delete(s.id);
  }
  return n;
}
export async function scoreAllOnce(deps: TickDeps = {}): Promise<void> {
  await reconcileEndedMatches(deps.stop).catch((e) => console.error('[range] reconcile failed', e));
  const running = getDb().prepare("SELECT match_session_id AS id FROM range_target_matches WHERE status = 'RUNNING'").all() as Array<{ id: string }>;
  for (const { id } of running) {
    if (scorer.busy.has(id)) continue;
    scorer.busy.add(id);
    try {
      await scoreTick(id, deps);
    } catch (e) {
      console.error(`[range] score tick failed for ${id}`, e);
    } finally {
      scorer.busy.delete(id);
    }
  }
}
// Idempotent: every range route calls this, so the scorer runs whenever the range is in use.
export function ensureScorerRunning(): void {
  ensureReaperRunning();
  if (scorer.timer !== undefined) return;
  scorer.timer = setInterval(() => void scoreAllOnce(), SCORE_INTERVAL_MS);
  scorer.timer.unref();
}
