import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { openLocalDatabase as getDb, getRangeMatch } from '@/lib/db';
import { getMatchAccess, getRangeEvents, rangeMatchExists, type Side } from '@/lib/range-runtime/lobby';
import { ensureScorerRunning } from '@/lib/range-runtime/scorer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const POLL_MS = 1000;
// Live feed. Members get their own team's feed (Red: RED+ALL events, Blue: BLUE+ALL). `?role=spectator` gives any
// signed-in user the aggregate feed only (ALL events and the vault balance).
export async function GET(req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  try {
    const user = await getCurrentUser();
    if (user === null) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const spectator = req.nextUrl.searchParams.get('role') === 'spectator';
    let view: Side | 'SPECTATOR';
    if (spectator) {
      if (!rangeMatchExists(matchId)) {
        return NextResponse.json({ success: false, error: 'Match not found.' }, { status: 404 });
      }
      view = 'SPECTATOR';
    } else {
      const access = getMatchAccess(user.id, matchId);
      if (access === null) {
        return NextResponse.json({ success: false, error: 'Forbidden: you are not a member of this match.' }, { status: 403 });
      }
      view = access.side;
    }
    ensureScorerRunning();
    const sessionId = matchId;
    const enc = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    let cursor = 0;
    let lastVault: number | null | undefined;
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        const close = () => {
          if (closed) return;
          closed = true;
          if (timer !== undefined) clearInterval(timer);
          try { controller.close(); } catch { /* already closed */ }
        };
        const pump = () => {
          if (closed) return;
          try {
            const range = getRangeMatch(sessionId);
            if (range !== undefined && range.vault_balance_cents !== lastVault) {
              lastVault = range.vault_balance_cents;
              send('vault', { balance_cents: lastVault, status: range.status });
            }
            // Read the match state before the events so the final summary row is delivered before we close.
            const sess = getDb().prepare('SELECT status FROM match_sessions WHERE id = ?').get(sessionId) as { status: string } | undefined;
            for (const ev of getRangeEvents(sessionId, view, cursor)) {
              cursor = ev.rowid;
              send('audit', { id: ev.rowid, action: ev.action, user: ev.userName, details: ev.details, at: ev.at });
            }
            if (sess === undefined || sess.status !== 'ACTIVE') {
              send('end', { matchId: sessionId });
              close();
            }
          } catch (e) {
            console.error('[range] events pump failed', e);
            close();
          }
        };
        controller.enqueue(enc.encode(': connected\n\n'));
        pump();
        if (!closed) timer = setInterval(pump, POLL_MS);
        req.signal.addEventListener('abort', close);
      },
      cancel() {
        if (timer !== undefined) clearInterval(timer);
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}
