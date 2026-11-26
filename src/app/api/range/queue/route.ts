import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, checkRateLimit } from '@/lib/session';
import { recordAuditLog } from '@/lib/db';
import { startMatch, stopMatch } from '@/lib/range-runtime/orchestrator';
import { joinRangeQueue, endRangeSession, getMatchAccess, recordRangeEvent } from '@/lib/range-runtime/lobby';
import { ensureScorerRunning } from '@/lib/range-runtime/scorer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (user === null) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (Number(user.is_profile_completed) !== 1) {
      return NextResponse.json({ success: false, error: 'Complete your profile first.' }, { status: 403 });
    }
    const rl = checkRateLimit(`rq_${user.id}`, 30, 60);
    if (rl.allowed === false) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });
    }
    const body = await req.json().catch(() => ({}));
    const teamId = typeof body.teamId === 'string' ? body.teamId.slice(0, 100) : '';
    if (teamId === '') {
      return NextResponse.json({ success: false, error: 'Missing team ID' }, { status: 400 });
    }
    const result = joinRangeQueue(user.id, teamId);
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
