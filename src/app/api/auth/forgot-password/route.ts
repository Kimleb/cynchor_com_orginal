import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkRateLimit } from '@/lib/session';
import { usernameSchema } from '@/lib/validators';

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.ip || 'local';
  const limit = checkRateLimit(`forgot_password_${ip}`, 5, 300);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, {
      status: 429, headers: { 'Retry-After': String(limit.retryAfter ?? 300) },
    });
  }
  const body = await req.json().catch(() => null);
  const username = usernameSchema.safeParse(body?.username);
  if (!username.success) return NextResponse.json({ error: 'Enter a valid username.' }, { status: 400 });

  const now = new Date();
  const cooldown = new Date(now.getTime() - 15 * 60000).toISOString();
  await getDb().prepare(`
    INSERT INTO access_requests (id, note, status, source, created_at)
    SELECT 'reset_' || id, username, 'PENDING', 'password-reset', ? FROM users WHERE username = ?
    ON CONFLICT(id) DO UPDATE SET status = 'PENDING', created_at = excluded.created_at, approved_at = NULL
    WHERE access_requests.status <> 'PENDING' AND access_requests.approved_at <= ?
  `).run(now.toISOString(), username.data, cooldown);

  return NextResponse.json({ success: true });
}
