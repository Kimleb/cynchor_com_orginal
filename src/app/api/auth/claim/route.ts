import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  getDb,
  hashPassword,
  inspectClaimToken,
  verifyAndConsumeInvite,
  recordAuditLog,
} from '@/lib/db';
import { checkRateLimit, revokeUserSessions, setSessionCookie } from '@/lib/session';
import { claimAccountSchema, usernameSchema } from '@/lib/validators';

export async function POST(req: NextRequest) {
  try {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.ip || '127.0.0.1';
    const rl = checkRateLimit(`claim_${ip}`, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const parseResult = claimAccountSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: parseResult.error.issues?.[0]?.message || 'Invalid claim payload.' },
        { status: 400 }
      );
    }

    const { token, username: requestedUsername, password } = parseResult.data;

    // Inspect token before consuming so validation errors don't burn a valid token
    const preview = await inspectClaimToken(token);
    if (!preview.valid) {
      return NextResponse.json({ success: false, error: preview.error || 'Invalid claim token.' }, { status: 400 });
    }

    const db = getDb();

    if (preview.purpose === 'RESET' && preview.targetUserId) {
      const targetUser = (await db
        .prepare('SELECT id, username, is_profile_completed FROM users WHERE id = ?')
        .get(preview.targetUserId)) as { id: string; username: string; is_profile_completed: number } | undefined;

      if (!targetUser) {
        return NextResponse.json({ success: false, error: 'Target account no longer exists.' }, { status: 404 });
      }

      const passwordHash = hashPassword(password);
      const failure = await db.transaction(async () => {
        const consumed = await verifyAndConsumeInvite(token);
        if (!consumed.valid) {
          return consumed.error || 'Invalid reset link.';
        }
        await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, targetUser.id);
        await revokeUserSessions(targetUser.id);
        await db.prepare("UPDATE invites SET is_used = 1 WHERE purpose = 'RESET' AND target_user_id = ? AND is_used = 0")
          .run(targetUser.id);
        return null;
      });
      if (failure) return NextResponse.json({ success: false, error: failure }, { status: 400 });
      await setSessionCookie(targetUser.id);

      await recordAuditLog({
        userId: targetUser.username,
        action: 'PASSWORD_RESET_COMPLETED',
        details: `Password reset via one-time claim link for ${targetUser.username}`,
        ip,
      });

      const isNew = Number(targetUser.is_profile_completed) === 0;
      return NextResponse.json({
        success: true,
        redirectTo: isNew ? '/demo/profile' : '/demo/dashboard',
      });
    }

    // Standard account claim flow
    const chosenRaw = requestedUsername ?? preview.username ?? '';
    const unameParse = usernameSchema.safeParse(chosenRaw);
    if (!unameParse.success) {
      return NextResponse.json(
        { success: false, error: unameParse.error.issues?.[0]?.message || 'A valid username is required.' },
        { status: 400 }
      );
    }
    const finalUsername = unameParse.data;

    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(finalUsername);
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'That username is already taken. Choose another handle.' },
        { status: 409 }
      );
    }

    const consumed = await verifyAndConsumeInvite(token);
    if (!consumed.valid) {
      return NextResponse.json({ success: false, error: consumed.error || 'Invalid claim token.' }, { status: 400 });
    }

    const newUserId = `user_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO users (id, username, password_hash, role, experience_level, is_profile_completed, is_operator, created_at)
      VALUES (?, ?, ?, NULL, NULL, 0, 0, ?)
    `).run(newUserId, finalUsername, hashPassword(password), now);

    await setSessionCookie(newUserId);

    await recordAuditLog({
      userId: finalUsername,
      action: 'ACCOUNT_CLAIMED',
      details: `Account claimed by username ${finalUsername}`,
      ip,
    });

    return NextResponse.json({
      success: true,
      redirectTo: '/demo/profile',
    });
  } catch (err: unknown) {
    console.error('claim error:', err);
    return NextResponse.json({ success: false, error: 'Failed to claim account.' }, { status: 500 });
  }
}
