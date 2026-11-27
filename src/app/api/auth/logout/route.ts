import { NextResponse } from 'next/server';
import { clearSessionCookie, getCurrentUser, revokeUserSessions } from '@/lib/session';
import { recordAuditLog } from '@/lib/db';

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (user !== null) {
    await revokeUserSessions(user.id);
    await recordAuditLog({ userId: user.username, action: 'LOGOUT', details: 'Session revoked server-side' });
  }
  await clearSessionCookie();
  if (req.headers.get('accept')?.includes('text/html')) {
    return new NextResponse(null, { status: 303, headers: { Location: '/demo/login' } });
  }
  return NextResponse.json({ success: true, redirectTo: '/' });
}
