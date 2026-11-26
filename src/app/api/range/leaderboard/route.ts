import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { EXPLOIT_IDS, type ExploitId } from '@/lib/range-runtime/exploitChecks';
import { buildLeaderboard, type LeaderboardFilter } from '@/lib/range-runtime/reports';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (user === null) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const params = new URL(req.url).searchParams;
    const filter: LeaderboardFilter = {};
    const matchId = params.get('matchId');
    if (matchId !== null && matchId !== '') {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(matchId)) return NextResponse.json({ success: false, error: 'Invalid matchId.' }, { status: 400 });
      filter.matchId = matchId;
    }
    const exploit = params.get('exploit');
    if (exploit !== null && exploit !== '') {
      if (!(EXPLOIT_IDS as string[]).includes(exploit)) return NextResponse.json({ success: false, error: 'Invalid exploit.' }, { status: 400 });
      filter.exploit = exploit as ExploitId;
    }
    return NextResponse.json({ success: true, ...buildLeaderboard(filter) });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}
