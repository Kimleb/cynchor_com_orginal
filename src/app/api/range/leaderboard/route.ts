import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { buildLeaderboard } from '@/lib/range-runtime/reports';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (user === null) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: true, ...buildLeaderboard() });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}
