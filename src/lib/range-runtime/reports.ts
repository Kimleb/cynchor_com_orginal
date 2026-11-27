// Read-only report and leaderboard queries over ended range matches. Database only; usernames, never emails.
import { openLocalDatabase as getDb, getRangeMatch } from '@/lib/db';
import { EXPLOIT_IDS, type ExploitId } from '@/lib/range-runtime/exploitChecks';

export const VAULT_START_CENTS = 50_000_000;

export type Summary = { reason: string; winner: string; vaultCents: number | null; mvpRed: string | null; mvpBlue: string | null };

function parseSummary(details: string): Summary {
  const get = (k: string) => new RegExp(`${k}=(\\S+)`).exec(details)?.[1] ?? null;
  const vault = get('vault_cents');
  const mvp = (v: string | null) => (v === null || v === 'none' ? null : v);
  return {
    reason: get('reason') ?? 'unknown',
    winner: get('winner') ?? 'none',
    vaultCents: vault !== null && /^\d+$/.test(vault) ? Number(vault) : null,
    mvpRed: mvp(get('mvp_red')),
    mvpBlue: mvp(get('mvp_blue')),
  };
}

const nameOf = (userId: string): string | null => (getDb().prepare('SELECT username AS name FROM users WHERE id = ?').get(userId) as { name: string } | undefined)?.name ?? null;

function mvpView(raw: string | null): { name: string; count: number } | null {
  const m = raw === null ? null : /^(.*)\((\d+)\)$/.exec(raw);
  if (m === null) return null;
  return { name: nameOf(m[1]) ?? 'unknown', count: Number(m[2]) };
}

export type TimelineEvent = { id: number; action: string; scope: string; user: string | null; details: string; at: string };

export type MatchReport = {
  matchId: string;
  redTeam: string | null;
  blueTeam: string | null;
  startedAt: string;
  winner: string;
  reason: string;
  vault: { startCents: number; finalCents: number | null; drainedCents: number | null; survivedCents: number | null };
  score: { exploitsLanded: number; exploitsBlocked: number; patchesApplied: number };
  mvp: { red: { name: string; count: number } | null; blue: { name: string; count: number } | null };
  timeline: TimelineEvent[];
};

// Null when the match does not exist, is not a range match, or has not ended yet.
export function buildReport(matchId: string): MatchReport | null {
  const db = getDb();
  const ms = db.prepare(`
    SELECT ms.status AS status, ms.created_at AS created_at, rt.name AS red_name, bt.name AS blue_name
    FROM match_sessions ms LEFT JOIN teams rt ON rt.id = ms.red_team_id LEFT JOIN teams bt ON bt.id = ms.blue_team_id
    WHERE ms.id = ? AND ms.mode = 'RANGE'
  `).get(matchId) as { status: string; created_at: string; red_name: string | null; blue_name: string | null } | undefined;
  if (ms === undefined || ms.status === 'ACTIVE') return null;
  const rows = db.prepare(`
    SELECT a.rowid AS id, a.action AS action, a.details AS details, a.created_at AS at, u.username AS user
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    WHERE instr(a.details, ?) = 1 AND a.action <> 'RANGE_CONTAINER_LOG'
    ORDER BY a.rowid ASC LIMIT 2000
  `).all(`[range:${matchId}:`) as Array<{ id: number; action: string; details: string; at: string; user: string | null }>;
  const timeline: TimelineEvent[] = rows.map((r) => {
    const m = /^\[range:[^:\]]+:(RED|BLUE|ALL)\]\s*/.exec(r.details);
    return { id: r.id, action: r.action, scope: m?.[1] ?? 'ALL', user: r.user, details: m ? r.details.slice(m[0].length) : r.details, at: r.at };
  });
  const endRow = rows.filter((r) => r.action === 'RANGE_MATCH_ENDED').pop();
  const summary: Summary = endRow ? parseSummary(endRow.details) : { reason: 'unknown', winner: 'none', vaultCents: null, mvpRed: null, mvpBlue: null };
  const finalCents = summary.vaultCents ?? getRangeMatch(matchId)?.vault_balance_cents ?? null;
  const count = (a: string) => rows.filter((r) => r.action === a).length;
  return {
    matchId,
    redTeam: ms.red_name,
    blueTeam: ms.blue_name,
    startedAt: ms.created_at,
    winner: summary.winner,
    reason: summary.reason,
    vault: {
      startCents: VAULT_START_CENTS,
      finalCents,
      drainedCents: finalCents === null ? null : Math.max(0, VAULT_START_CENTS - finalCents),
      survivedCents: finalCents,
    },
    score: { exploitsLanded: count('RANGE_EXPLOIT_LANDED'), exploitsBlocked: count('RANGE_EXPLOIT_BLOCKED'), patchesApplied: count('RANGE_PATCH_APPLIED') },
    mvp: { red: mvpView(summary.mvpRed), blue: mvpView(summary.mvpBlue) },
    timeline,
  };
}

export type LeaderboardFilter = { matchId?: string; exploit?: ExploitId };
export type Leaderboard = {
  matchesPlayed: number;
  teams: Array<{ team: string; side: string; played: number; wins: number }>;
  players: Array<{ name: string; exploits: number; patches: number }>;
  filters: { matches: Array<{ id: string; label: string }>; exploits: ExploitId[] };
};
// Room = match session id, level = exploit id. A filtered board only counts matches (and landed exploits) that fit.
export function buildLeaderboard(filter: LeaderboardFilter = {}): Leaderboard {
  const db = getDb();
  const all = db.prepare(`
    SELECT ms.id AS id, rt.name AS red_name, bt.name AS blue_name
    FROM match_sessions ms LEFT JOIN teams rt ON rt.id = ms.red_team_id LEFT JOIN teams bt ON bt.id = ms.blue_team_id
    WHERE ms.mode = 'RANGE' AND ms.status <> 'ACTIVE' ORDER BY ms.created_at DESC, ms.id ASC
  `).all() as Array<{ id: string; red_name: string | null; blue_name: string | null }>;
  const exploitTag = filter.exploit === undefined ? null : `exploit=${filter.exploit} `;
  const landedIn = new Set<string>();
  if (exploitTag !== null) {
    const landed = db.prepare("SELECT details FROM audit_logs WHERE action = 'RANGE_EXPLOIT_LANDED' AND instr(details, '[range:') = 1 AND instr(details, ?) > 0").all(exploitTag) as Array<{ details: string }>;
    for (const r of landed) {
      const id = /^\[range:([^:\]]+):/.exec(r.details)?.[1];
      if (id !== undefined) landedIn.add(id);
    }
  }
  const sessions = all.filter((s) => (filter.matchId === undefined || s.id === filter.matchId) && (exploitTag === null || landedIn.has(s.id)));
  const keep = new Set(sessions.map((s) => s.id));
  const endRows = db.prepare("SELECT details FROM audit_logs WHERE action = 'RANGE_MATCH_ENDED' AND instr(details, '[range:') = 1").all() as Array<{ details: string }>;
  const winners = new Map<string, string>();
  for (const r of endRows) {
    const id = /^\[range:([^:\]]+):/.exec(r.details)?.[1];
    if (id !== undefined) winners.set(id, parseSummary(r.details).winner);
  }
  const teams = new Map<string, { team: string; side: string; played: number; wins: number }>();
  const bump = (name: string | null, side: string, won: boolean) => {
    if (name === null) return;
    const e = teams.get(`${side}:${name}`) ?? { team: name, side, played: 0, wins: 0 };
    e.played += 1;
    if (won) e.wins += 1;
    teams.set(`${side}:${name}`, e);
  };
  for (const s of sessions) {
    const w = winners.get(s.id);
    bump(s.red_name, 'RED', w === 'RED');
    bump(s.blue_name, 'BLUE', w === 'BLUE');
  }
  const rows = db.prepare(`
    SELECT u.username AS name, a.action AS action, a.details AS details
    FROM audit_logs a JOIN users u ON u.id = a.user_id
    WHERE a.action IN ('RANGE_EXPLOIT_LANDED', 'RANGE_PATCH_APPLIED') AND instr(a.details, '[range:') = 1
  `).all() as Array<{ name: string; action: string; details: string }>;
  const tally = new Map<string, { name: string; exploits: number; patches: number }>();
  for (const r of rows) {
    const id = /^\[range:([^:\]]+):/.exec(r.details)?.[1];
    if (id === undefined || !keep.has(id)) continue;
    if (exploitTag !== null && !(r.action === 'RANGE_EXPLOIT_LANDED' && r.details.includes(exploitTag))) continue;
    const e = tally.get(r.name) ?? { name: r.name, exploits: 0, patches: 0 };
    if (r.action === 'RANGE_EXPLOIT_LANDED') e.exploits += 1;
    else e.patches += 1;
    tally.set(r.name, e);
  }
  const players = Array.from(tally.values()).sort((a, b) => b.exploits + b.patches - (a.exploits + a.patches) || a.name.localeCompare(b.name)).slice(0, 50);
  return {
    matchesPlayed: sessions.length,
    teams: Array.from(teams.values()).sort((a, b) => b.wins - a.wins || a.team.localeCompare(b.team)),
    players,
    filters: { matches: all.map((s) => ({ id: s.id, label: `${s.red_name ?? '?'} vs ${s.blue_name ?? '?'}` })), exploits: [...EXPLOIT_IDS] },
  };
}
