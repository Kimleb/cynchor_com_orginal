import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { buildReport } from '@/lib/range-runtime/reports';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// After Action Report: any signed-in user, once the match has ended.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  try {
    const user = await getCurrentUser();
    if (user === null) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const report = buildReport(matchId);
    if (report === null) {
      return NextResponse.json({ success: false, error: 'No ended range match with this ID.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, report });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}
