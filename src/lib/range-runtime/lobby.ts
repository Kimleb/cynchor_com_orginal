// Database-only range lobby logic: queue/pairing, per-match access checks, tagged events and match end.
// No Docker imports, so tests can exercise it without a container.
import crypto from 'crypto';
import { openLocalDatabase as getDb, endLocalMatch as endMatch, endStaleLocalMatches as endStaleMatches, recordLocalAuditLog as recordAuditLog, getRangeMatch, type RangeMatchRow } from '@/lib/db';
export type Side = 'RED' | 'BLUE';
export type EventScope = Side | 'ALL';
export const DEFAULT_MIN_TEAM_SIZE = 2;
export function minTeamSize(): number {
  const n = Number.parseInt(process.env.RANGE_MIN_TEAM_SIZE ?? '', 10);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MIN_TEAM_SIZE;
}
// Every range audit row starts with this tag so the feed can select by match and by who may see it.
export const rangeTag = (matchId: string, scope: EventScope) => `[range:${matchId}:${scope}]`;
export function recordRangeEvent(e: { matchId: string; scope: EventScope; action: string; userId?: string; details: string }) {
  recordAuditLog({ userId: e.userId, action: e.action, details: `${rangeTag(e.matchId, e.scope)} ${e.details}` });
}
type TeamRow = { id: string; name: string; side: Side };
export type QueueResult =
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'too_small'; min: number }
  | { kind: 'busy' }
  | { kind: 'queued'; team: TeamRow; size: number }
  | { kind: 'matched'; sessionId: string; redTeamId: string; blueTeamId: string; created: boolean };
// Same atomic BEGIN IMMEDIATE pairing as /api/matchmaking, but the session is tagged mode RANGE and the minimum
// size comes from RANGE_MIN_TEAM_SIZE (default 2).
export function joinRangeQueue(userId: string, teamId: string, min = minTeamSize()): QueueResult {
  const db = getDb();
  endStaleMatches();
  if (db.prepare('SELECT 1 AS ok FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId) === undefined) return { kind: 'forbidden' };
  const team = db.prepare('SELECT id, name, side FROM teams WHERE id = ?').get(teamId) as TeamRow | undefined;
  if (team === undefined) return { kind: 'not_found' };
  const size = (db.prepare('SELECT COUNT(*) AS c FROM team_members WHERE team_id = ?').get(teamId) as { c: number }).c;
  if (size < min) return { kind: 'too_small', min };
  const existing = db.prepare("SELECT id, mode, red_team_id, blue_team_id FROM match_sessions WHERE (red_team_id = ? OR blue_team_id = ?) AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1")
    .get(teamId, teamId) as { id: string; mode: string; red_team_id: string; blue_team_id: string } | undefined;
  if (existing !== undefined) {
    if (existing.mode !== 'RANGE') return { kind: 'busy' };
    return { kind: 'matched', sessionId: existing.id, redTeamId: existing.red_team_id, blueTeamId: existing.blue_team_id, created: false };
  }
  const opposing: Side = team.side === 'RED' ? 'BLUE' : 'RED';
  const now = new Date().toISOString();
  let paired: { sessionId: string; redTeamId: string; blueTeamId: string } | null = null;
  db.exec('BEGIN IMMEDIATE');
  try {
    const opp = db.prepare(`
      SELECT q.team_id AS team_id FROM matchmaking_queue q JOIN teams t ON t.id = q.team_id
      WHERE q.side = ? AND q.status = 'WAITING' AND q.team_id <> ?
        AND (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) >= ?
      ORDER BY q.joined_at ASC LIMIT 1
    `).get(opposing, teamId, min) as { team_id: string } | undefined;
    if (opp !== undefined) {
      const sessionId = `match_${crypto.randomUUID()}`;
      const redTeamId = team.side === 'RED' ? team.id : opp.team_id;
      const blueTeamId = team.side === 'BLUE' ? team.id : opp.team_id;
      db.prepare("INSERT INTO match_sessions (id, red_team_id, blue_team_id, mode, status, created_at) VALUES (?, ?, ?, 'RANGE', 'ACTIVE', ?)").run(sessionId, redTeamId, blueTeamId, now);
      db.prepare("UPDATE matchmaking_queue SET status = 'MATCHED' WHERE team_id IN (?, ?)").run(team.id, opp.team_id);
      db.prepare("UPDATE teams SET status = 'MATCHED' WHERE id IN (?, ?)").run(team.id, opp.team_id);
      paired = { sessionId, redTeamId, blueTeamId };
    } else if (db.prepare("SELECT 1 AS ok FROM matchmaking_queue WHERE team_id = ? AND status = 'WAITING'").get(teamId) === undefined) {
      db.prepare('DELETE FROM matchmaking_queue WHERE team_id = ?').run(teamId);
      db.prepare("INSERT INTO matchmaking_queue (id, team_id, side, status, joined_at) VALUES (?, ?, ?, 'WAITING', ?)").run(`q_${crypto.randomUUID()}`, teamId, team.side, now);
      db.prepare("UPDATE teams SET status = 'QUEUED' WHERE id = ?").run(teamId);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  if (paired === null) return { kind: 'queued', team, size };
  recordRangeEvent({ matchId: paired.sessionId, scope: 'ALL', action: 'RANGE_MATCH_PAIRED', userId, details: `${paired.redTeamId} (RED) vs ${paired.blueTeamId} (BLUE)` });
  return { kind: 'matched', ...paired, created: true };
}
export type MatchAccess = { sessionId: string; side: Side; matchActive: boolean; range: RangeMatchRow | undefined };
// Side comes from team membership in the database, never from the request. Null means not a member (or no such range match).
export function getMatchAccess(userId: string, sessionId: string): MatchAccess | null {
  const row = getDb().prepare(`
    SELECT ms.id AS id, ms.status AS status,
           CASE WHEN rtm.user_id IS NOT NULL THEN 'RED' ELSE 'BLUE' END AS side
    FROM match_sessions ms
    LEFT JOIN team_members rtm ON rtm.team_id = ms.red_team_id AND rtm.user_id = ?
    LEFT JOIN team_members btm ON btm.team_id = ms.blue_team_id AND btm.user_id = ?
    WHERE ms.id = ? AND ms.mode = 'RANGE' AND (rtm.user_id IS NOT NULL OR btm.user_id IS NOT NULL)
  `).get(userId, userId, sessionId) as { id: string; status: string; side: Side } | undefined;
  if (row === undefined) return null;
  return { sessionId: row.id, side: row.side, matchActive: row.status === 'ACTIVE', range: getRangeMatch(row.id) };
}
export function rangeMatchExists(sessionId: string): boolean {
  return getDb().prepare("SELECT 1 AS ok FROM match_sessions WHERE id = ? AND mode = 'RANGE'").get(sessionId) !== undefined;
}
export type FeedEvent = { rowid: number; action: string; userName: string | null; details: string; at: string };
// Red sees RED+ALL rows, Blue sees BLUE+ALL rows, the spectator sees ALL rows only.
export function getRangeEvents(sessionId: string, view: Side | 'SPECTATOR', afterRowid: number, limit = 100): FeedEvent[] {
  const own = view === 'SPECTATOR' ? rangeTag(sessionId, 'ALL') : rangeTag(sessionId, view);
  const rows = getDb().prepare(`
    SELECT a.rowid AS rowid, a.action AS action, a.details AS details, a.created_at AS at, u.username AS userName
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.rowid > ? AND (instr(a.details, ?) = 1 OR instr(a.details, ?) = 1)
    ORDER BY a.rowid ASC LIMIT ?
  `).all(afterRowid, own, rangeTag(sessionId, 'ALL'), limit) as unknown as FeedEvent[];
  return rows.map((r) => ({ ...r, userName: view === 'SPECTATOR' ? null : r.userName }));
}
export function latestAuditRowid(): number {
  return Number((getDb().prepare('SELECT COALESCE(MAX(rowid), 0) AS m FROM audit_logs').get() as { m: number }).m);
}
function countByUser(sessionId: string, action: string): Array<{ user_id: string; n: number }> {
  return getDb().prepare(`
    SELECT user_id, COUNT(*) AS n FROM audit_logs
    WHERE action = ? AND instr(details, ?) > 0 AND user_id <> 'ANONYMOUS'
    GROUP BY user_id ORDER BY n DESC, user_id ASC
  `).all(action, `[range:${sessionId}:`) as Array<{ user_id: string; n: number }>;
}
// MVP per team: the Red member with most RANGE_EXPLOIT_LANDED rows, the Blue member with most RANGE_PATCH_APPLIED rows.
export function computeMvps(sessionId: string): { red: { userId: string; count: number } | null; blue: { userId: string; count: number } | null } {
  const db = getDb();
  const teams = db.prepare('SELECT red_team_id, blue_team_id FROM match_sessions WHERE id = ?').get(sessionId) as { red_team_id: string; blue_team_id: string } | undefined;
  if (teams === undefined) return { red: null, blue: null };
  const isMember = (teamId: string, userId: string) => db.prepare('SELECT 1 AS ok FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId) !== undefined;
  const pick = (action: string, teamId: string) => {
    const hit = countByUser(sessionId, action).find((r) => isMember(teamId, r.user_id));
    return hit ? { userId: hit.user_id, count: hit.n } : null;
  };
  return { red: pick('RANGE_EXPLOIT_LANDED', teams.red_team_id), blue: pick('RANGE_PATCH_APPLIED', teams.blue_team_id) };
}
export type EndReason = 'vault-zero' | 'timeout' | 'killed' | 'ended';
const RANGE_STOP_REASON = { 'vault-zero': 'ENDED', timeout: 'TIMEOUT', killed: 'KILLED', ended: 'ENDED' } as const;
export type StopFn = (sessionId: string, opts: { reason: 'ENDED' | 'TIMEOUT' | 'KILLED'; details?: string }) => Promise<boolean>;
// Ends the container (idempotent), frees both teams exactly as endMatch() does, and writes one summary row.
// Safe to call from the scorer, a timeout or a kill: only the caller that flips match_sessions to ENDED writes the summary.
export async function endRangeSession(sessionId: string, reason: EndReason, stop: StopFn): Promise<boolean> {
  await stop(sessionId, { reason: RANGE_STOP_REASON[reason], details: reason });
  const vault = getRangeMatch(sessionId)?.vault_balance_cents ?? null;
  const mvps = computeMvps(sessionId);
  if (endMatch(sessionId) === false) return false;
  const winner = reason === 'vault-zero' ? 'RED' : reason === 'killed' ? 'none' : 'BLUE';
  const fmt = (m: { userId: string; count: number } | null) => (m ? `${m.userId}(${m.count})` : 'none');
  recordRangeEvent({
    matchId: sessionId, scope: 'ALL', action: 'RANGE_MATCH_ENDED',
    details: `reason=${reason} winner=${winner} vault_cents=${vault ?? 'unknown'} mvp_red=${fmt(mvps.red)} mvp_blue=${fmt(mvps.blue)}`,
  });
  return true;
}
