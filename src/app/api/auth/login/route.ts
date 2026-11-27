import { NextRequest, NextResponse } from 'next/server';
import { getDb, verifyPassword, recordAuditLog, inspectClaimToken, verifyAndConsumeInvite } from '@/lib/db';
import { checkRateLimit, resetRateLimit, setSessionCookie } from '@/lib/session';
import { loginSchema } from '@/lib/validators';
import { User } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || '127.0.0.1';

    // Rate limit login attempts: max 5 attempts with lockout backoff
    const rateCheck = checkRateLimit(`login_${ip}`, 5, 60);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many login attempts. Account temporarily locked for ${rateCheck.retryAfter || 60} seconds.`,
        },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter || 60) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const parseResult = loginSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: parseResult.error.issues?.[0]?.message || 'Invalid input credentials.' },
        { status: 400 }
      );
    }

    const { username, password } = parseResult.data;
    const usernameRate = checkRateLimit(`login_username_${username.toLowerCase()}`, 5, 60);
    if (!usernameRate.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(usernameRate.retryAfter || 60) } }
      );
    }
    const inviteToken = body.inviteToken;

    const db = getDb();
    const userStmt = db.prepare('SELECT id, username, password_hash, role, experience_level, is_profile_completed, is_operator, created_at FROM users WHERE username = ?');
    const user = (await userStmt.get(username)) as (User & { password_hash: string }) | undefined;

    // Timing-safe check: no user enumeration (same time taken even if user does not exist)
    const dummyHash =
      '00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const hashToVerify = user ? user.password_hash : dummyHash;
    const isValid = verifyPassword(password, hashToVerify);

    if (!user || !isValid) {
      await recordAuditLog({
        userId: username,
        action: 'LOGIN_FAILED',
        details: 'Failed credentials entered',
        ip,
      });
      return NextResponse.json(
        { success: false, error: 'Invalid username or password.' },
        { status: 401 }
      );
    }

    if (typeof inviteToken === 'string' && (await inspectClaimToken(inviteToken)).purpose === 'CLAIM') {
      await verifyAndConsumeInvite(inviteToken);
    }

    await setSessionCookie(user.id);
    resetRateLimit(`login_${ip}`);
    resetRateLimit(`login_username_${username}`);

    await recordAuditLog({
      userId: user.username,
      action: 'LOGIN_SUCCESS',
      details: `User ${user.username} logged in successfully`,
      ip,
    });

    const isNew = Number(user.is_profile_completed) === 0;

    return NextResponse.json({
      success: true,
      isNew,
      redirectTo: isNew ? '/demo/profile' : '/demo/dashboard',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        is_operator: user.is_operator,
      },
    });
  } catch (err: unknown) {
    console.error('login error:', err);
    return NextResponse.json({ success: false, error: 'Authentication failure.' }, { status: 500 });
  }
}
