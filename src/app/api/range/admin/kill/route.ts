import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { stopMatch } from '@/lib/range-runtime/orchestrator';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.is_operator) {
      return NextResponse.json({ success: false, error: 'Forbidden: Operator privileges required' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const matchId = typeof body.matchId === 'string' ? body.matchId.slice(0, 100) : '';
    if (matchId === '') {
      return NextResponse.json({ success: false, error: 'matchId is required.' }, { status: 400 });
    }
    const killed = await stopMatch(matchId, { reason: 'KILLED', userId: user.id });
    if (!killed) {
      return NextResponse.json({ success: false, error: 'No running range match found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}
