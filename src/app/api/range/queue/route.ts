import { hasRangeAccess } from '@/lib/team-rules';
import { teamReady } from '@/lib/team-rules';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, checkRateLimit } from '@/lib/session';
import { recordLocalAuditLog as recordAuditLog, openLocalDatabase as getDb } from '@/lib/db';
import { startMatch, stopMatch } from '@/lib/range-runtime/orchestrator';
import { joinRangeQueue, endRangeSession, getMatchAccess, recordRangeEvent } from '@/lib/range-runtime/lobby';
import { TEAM_SIZE } from '@/lib/demo-team';
import { ensureScorerRunning } from '@/lib/range-runtime/scorer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (user === null) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!await hasRangeAccess(user.id)) return NextResponse.json({ success: false, error: 'Complete team formation and accept the rules of engagement.' }, { status: 403 });
    if (Number(user.is_profile_completed) !== 1) {
      return NextResponse.json({ success: false, error: 'Complete your profile first.' }, { status: 403 });
    }
    const rl = checkRateLimit(`rq_${user.id}`, 30, 60);
    if (rl.allowed === false) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });
    }
    const body = (await req.json().catch(() => null)) ?? {};
    const teamId = typeof body.teamId === 'string' ? body.teamId.slice(0, 100) : '';
    if (teamId === '') {
      return NextResponse.json({ success: false, error: 'Missing team ID' }, { status: 400 });
    }
    const membership = getDb().prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, user.id);
    if (!membership) return NextResponse.json({ success: false, error: 'Join the team first.' }, { status: 403 });
    const roster = getDb().prepare('SELECT COUNT(*) AS size FROM team_members WHERE team_id = ?').get(teamId);
    if (Number(roster?.size) !== TEAM_SIZE) {
      return NextResponse.json({ success: false, error: 'The range queue requires a team of exactly three players.' }, { status: 400 });
    }
    if (!await teamReady(teamId)) return NextResponse.json({ success: false, error: 'All three team members must accept the rules of engagement.' }, { status: 403 });
    const result = joinRangeQueue(user.id, teamId, TEAM_SIZE);
    switch (result.kind) {
      case 'forbidden':
        return NextResponse.json({ success: false, error: 'Forbidden: you are not a member of this team.' }, { status: 403 });
      case 'not_found':
        return NextResponse.json({ success: false, error: 'Team not found.' }, { status: 404 });
      case 'too_small':
        return NextResponse.json({ success: false, error: `Team must have at least ${result.min} members to enter the range queue.` }, { status: 400 });
      case 'busy':
        return NextResponse.json({ success: false, error: 'This team is already in another active match.' }, { status: 409 });
      case 'queued':
        return NextResponse.json({ success: true, matched: false, message: 'Squad queued. Searching for an opposing team...' });
      case 'matched':
        break;
    }
    ensureScorerRunning();
    if (result.created) {
      // Both teams are committed to the session; bring up the target container for it.
      try {
        await startMatch(result.sessionId, { userId: user.id });
      } catch (e) {
        console.error('[range] startMatch failed', e);
        recordRangeEvent({ matchId: result.sessionId, scope: 'ALL', action: 'RANGE_MATCH_FAILED', userId: user.id, details: 'target container failed to start; teams released' });
        await endRangeSession(result.sessionId, 'ended', stopMatch);
        return NextResponse.json({ success: false, error: 'The range target could not be started. Your squads were released; try again.' }, { status: 502 });
      }
      recordAuditLog({ userId: user.id, action: 'RANGE_MATCH_CREATED', details: `Match ${result.sessionId}` });
    }
    const access = getMatchAccess(user.id, result.sessionId);
    return NextResponse.json({
      success: true,
      matched: true,
      sessionId: result.sessionId,
      side: access?.side ?? null,
      status: access?.range?.status ?? 'STARTING',
    });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}

// Read-only lobby state: the caller's team, any active range match for it, and who is waiting in the queue (team names only).
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (user === null) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!await hasRangeAccess(user.id)) return NextResponse.json({ success: false, error: 'Complete team formation and accept the rules of engagement.' }, { status: 403 });
    const db = getDb();
    const myTeam = db.prepare(`
      SELECT t.id AS id, t.name AS name, t.side AS side, t.status AS status,
             (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS size
      FROM teams t JOIN team_members tm ON tm.team_id = t.id WHERE tm.user_id = ? LIMIT 1
    `).get(user.id) as { id: string; name: string; side: 'RED' | 'BLUE'; status: string; size: number } | undefined;
    const active = myTeam === undefined ? undefined : db.prepare(
      "SELECT id FROM match_sessions WHERE mode = 'RANGE' AND status = 'ACTIVE' AND (red_team_id = ? OR blue_team_id = ?) ORDER BY created_at DESC LIMIT 1",
    ).get(myTeam.id, myTeam.id) as { id: string } | undefined;
    const queued = db.prepare(`
      SELECT t.name AS name, q.side AS side, q.joined_at AS joinedAt,
             (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS size
      FROM matchmaking_queue q JOIN teams t ON t.id = q.team_id WHERE q.status = 'WAITING' ORDER BY q.joined_at ASC LIMIT 50
    `).all();
    return NextResponse.json({ success: true, myTeam: myTeam ?? null, activeSessionId: active?.id ?? null, queued });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}
