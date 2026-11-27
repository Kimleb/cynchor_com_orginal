import { NextRequest, NextResponse } from 'next/server';
import { readJsonObject } from '@/lib/request-json';
import { getZipiOperator } from '@/lib/zipi-session';
import { getDb, hashPassword, createSecureInvite, recordAuditLog, getAuditLogs } from '@/lib/db';
import { usernameSchema } from '@/lib/validators';
import crypto from 'crypto';

export async function GET() {
  try {
    const user = await getZipiOperator();

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Operator privileges required' },
        { status: 403 }
      );
    }

    const db = getDb();
    const requests = await db
      .prepare(
        `SELECT id, note, status, source, created_at, approved_at, claim_token_hash, applicant_name, reply_email,
                CASE WHEN source = 'password-reset' THEN substr(id, 7) END AS reset_user_id
         FROM access_requests LEFT JOIN product_access_mail ON request_id = id ORDER BY created_at DESC`
      )
      .all();

    const invites = await db
      .prepare(
        'SELECT id, username, purpose, target_user_id, is_used, expires_at, created_at FROM invites ORDER BY created_at DESC'
      )
      .all();

    const users = await db
      .prepare(
        'SELECT id, username, role, experience_level, is_profile_completed, is_operator, created_at FROM users ORDER BY created_at DESC'
      )
      .all();

    const auditLogs = await getAuditLogs(50);

    return NextResponse.json({
      success: true,
      requests,
      invites,
      users,
      auditLogs,
      currentUser: user,
    });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getZipiOperator();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Operator privileges required' },
        { status: 403 }
      );
    }

    const body = await readJsonObject(req);
    if (!body) {
      return NextResponse.json({ success: false, error: 'Expected a JSON object.' }, { status: 400 });
    }
    const { action } = body;
    const db = getDb();
    const now = new Date().toISOString();
    const ip = req.headers.get('x-forwarded-for') || '127.0.0.1';

    if (action === 'APPROVE_REQUEST') {
      const { requestId, username } = body;
      if (typeof requestId !== 'string' || !requestId) {
        return NextResponse.json({ success: false, error: 'Missing request ID.' }, { status: 400 });
      }
      const unameParse = usernameSchema.safeParse(username);
      if (!unameParse.success) {
        return NextResponse.json(
          { success: false, error: unameParse.error.issues?.[0]?.message || 'Valid username is required.' },
          { status: 400 }
        );
      }

      const reqRow = (await db
        .prepare("SELECT id, status FROM access_requests WHERE id = ? AND source <> 'password-reset'")
        .get(requestId)) as { id: string; status: string } | undefined;
      if (!reqRow || reqRow.status !== 'PENDING') {
        return NextResponse.json({ success: false, error: 'Request not found or already processed.' }, { status: 404 });
      }

      const targetUsername = unameParse.data;
      const { plainToken, tokenHash } = await createSecureInvite({ username: targetUsername, purpose: 'CLAIM' });

      await db.prepare(`
        UPDATE access_requests
        SET status = 'APPROVED', approved_at = ?, claim_token_hash = ?
        WHERE id = ?
      `).run(now, tokenHash, requestId);

      await recordAuditLog({
        userId: user.username,
        action: 'ACCESS_REQUEST_APPROVED',
        details: `Approved request ${requestId} for ${targetUsername}`,
        ip,
      });

      return NextResponse.json({
        success: true,
        token: plainToken,
        claimUrl: `/demo/claim/${plainToken}`,
      });
    }

    if (action === 'GENERATE_INVITE') {
      const { username } = body;
      const unameParse = usernameSchema.safeParse(username);
      if (!unameParse.success) {
        return NextResponse.json(
          { success: false, error: unameParse.error.issues?.[0]?.message || 'Valid username is required.' },
          { status: 400 }
        );
      }

      const targetUsername = unameParse.data;
      const { plainToken } = await createSecureInvite({ username: targetUsername, purpose: 'CLAIM' });

      await recordAuditLog({
        userId: user.username,
        action: 'INVITE_MANUALLY_GENERATED',
        details: `Operator created 256-bit claim link for ${targetUsername}`,
        ip,
      });

      return NextResponse.json({
        success: true,
        token: plainToken,
        claimUrl: `/demo/claim/${plainToken}`,
      });
    }

    if (action === 'ISSUE_RESET_LINK') {
      const { userId: targetUserId } = body;
      if (!targetUserId || typeof targetUserId !== 'string') {
        return NextResponse.json({ success: false, error: 'Target userId is required.' }, { status: 400 });
      }

      const target = (await db
        .prepare('SELECT id, username FROM users WHERE id = ?')
        .get(targetUserId)) as { id: string; username: string } | undefined;
      if (!target) {
        return NextResponse.json({ success: false, error: 'User not found.' }, { status: 404 });
      }

      const { plainToken } = await createSecureInvite({
        username: target.username,
        purpose: 'RESET',
        targetUserId: target.id,
        expiresInDays: 1 / 48,
      });
      await db.prepare("UPDATE access_requests SET status = 'APPROVED', approved_at = ? WHERE id = ? AND source = 'password-reset'")
        .run(now, 'reset_' + target.id);

      await recordAuditLog({
        userId: user.username,
        action: 'PASSWORD_RESET_LINK_ISSUED',
        details: `Operator issued password reset link for ${target.username}`,
        ip,
      });

      return NextResponse.json({
        success: true,
        token: plainToken,
        claimUrl: `/demo/claim/${plainToken}`,
        purpose: 'RESET',
      });
    }

    if (action === 'PROVISION_USER') {
      const { username, password, role = 'BLUE_TEAM' } = body;
      const unameParse = usernameSchema.safeParse(username);
      if (!unameParse.success) {
        return NextResponse.json(
          { success: false, error: unameParse.error.issues?.[0]?.message || 'Valid username is required.' },
          { status: 400 }
        );
      }

      if (
        typeof password !== 'string' ||
        password.length < 12 ||
        password.length > 128 ||
        typeof role !== 'string' ||
        !['RED_TEAM', 'BLUE_TEAM', 'NET_SEC'].includes(role)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'Valid username, a password of 12 to 128 characters, and a valid role are required.',
          },
          { status: 400 }
        );
      }

      const cleanUsername = unameParse.data;
      const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
      if (existing) {
        return NextResponse.json({ success: false, error: 'Username already exists.' }, { status: 409 });
      }

      const userId = `user_${crypto.randomUUID()}`;
      const pHash = hashPassword(password);

      await db.prepare(`
        INSERT INTO users (id, username, password_hash, role, experience_level, is_profile_completed, is_operator, created_at)
        VALUES (?, ?, ?, ?, 'INTERMEDIATE', 1, ?, ?)
      `).run(userId, cleanUsername, pHash, role, 0, now);

      await recordAuditLog({
        userId: user.username,
        action: 'USER_PROVISIONED',
        details: `Provisioned user ${cleanUsername} (Role: ${role})`,
        ip,
      });

      return NextResponse.json({ success: true, userId, username: cleanUsername });
    }

    return NextResponse.json({ success: false, error: 'Invalid admin action' }, { status: 400 });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}
