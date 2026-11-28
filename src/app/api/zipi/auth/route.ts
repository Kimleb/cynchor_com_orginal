import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, hashToken } from '@/lib/db';
import { checkRateLimit } from '@/lib/session';
import { staffEmail, verifyAuthenticator } from '@/lib/zipi-factors';
import { zipiChallenge, zipiSession, cookieOptions } from '@/lib/zipi-session';

const otp = z.string().regex(/^\d{6}$/);
const input = z.discriminatedUnion('step', [
  z.object({ step: z.literal('start'), email: staffEmail, code: otp }),
  z.object({ step: z.literal('verify'), code: otp }),
]);
const failure = () => NextResponse.json({ error: 'Invalid or expired verification details.' }, { status: 401 });
const unavailable = () => NextResponse.json({ error: 'Verification email is unavailable. Try again later.' }, { status: 503 });

function codeHash(challenge: string, code: string) {
  return crypto.createHmac('sha256', challenge).update(code).digest('hex');
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit('zipi_' + (req.headers.get('x-forwarded-for')?.split(',')[0] || 'local'), 20, 300);
  if (!limit.allowed) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  const data = input.safeParse(await req.json().catch(() => null));
  if (!data.success) return failure();
  const step = data.data;
  try {
    return await signIn(step);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : 'ZIPI_UNEXPECTED';
    console.error('Zipi operator sign-in unavailable', { step: step.step, code });
    return NextResponse.json({ error: 'Operator sign-in is temporarily unavailable.' }, { status: 503 });
  }
}

async function signIn(details: z.infer<typeof input>) {
  const db = getDb();
  const jar = await cookies();
  if (details.step === 'start') {
    const { email, code } = details;
    const operator = await verifyAuthenticator(email, code);
    if (!operator) return failure();
    const key = process.env.RESEND_API_KEY;
    const from = process.env.ZIPI_EMAIL_FROM || process.env.ACCESS_REQUEST_FROM;
    if (!key || !from) return unavailable();
    const challenge = crypto.randomBytes(32).toString('base64url');
    const emailCode = crypto.randomInt(1000000).toString().padStart(6, '0');
    const digest = hashToken(challenge);
    await db.prepare(`INSERT INTO zipi_challenges (token_hash, operator_id, code_hash, expires)
      VALUES (?, ?, ?, ?) ON CONFLICT (operator_id) DO UPDATE SET
      token_hash = excluded.token_hash, code_hash = excluded.code_hash, expires = excluded.expires, attempts = 0`).run(digest, operator, codeHash(challenge, emailCode), Date.now() + 600000);
    try {
      const delivery = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: 'Cynchor operator sign-in',
          text: `Your verification code is ${emailCode}. It expires in 10 minutes. Enter it only on the Cynchor console.` }),
      });
      if (!delivery.ok || !(await delivery.json()).id) throw new Error('Mail unavailable');
    } catch {
      await db.prepare('DELETE FROM zipi_challenges WHERE token_hash = ?').run(digest);
      return unavailable();
    }
    jar.set(zipiChallenge, challenge, { ...cookieOptions, maxAge: 600 });
    return NextResponse.json({ success: true });
  }
  const challenge = jar.get(zipiChallenge)?.value;
  if (!challenge) return failure();
  const digest = hashToken(challenge);
  const token = crypto.randomBytes(32).toString('base64url');
  const verified = await db.transaction(async () => {
    const row = await db.prepare(`UPDATE zipi_challenges SET attempts = attempts + 1
      WHERE token_hash = ? AND attempts < 5 AND expires > ? RETURNING code_hash, operator_id`).get(digest, Date.now());
    if (!row || !crypto.timingSafeEqual(Buffer.from(String(row.code_hash)), Buffer.from(codeHash(challenge, details.code)))) {
      return false;
    }
    await db.prepare('DELETE FROM zipi_challenges WHERE token_hash = ?').run(digest);
    await db.prepare('DELETE FROM zipi_sessions WHERE expires <= ?').run(Date.now());
    await db.prepare('INSERT INTO zipi_sessions (token_hash, operator_id, expires) VALUES (?, ?, ?)')
      .run(hashToken(token), row.operator_id, Date.now() + 4 * 3600000);
    return true;
  });
  if (!verified) return failure();
  jar.set(zipiSession, token, { ...cookieOptions, maxAge: 4 * 3600 });
  jar.delete(zipiChallenge);
  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const jar = await cookies();
  const token = jar.get(zipiSession)?.value;
  if (token) await getDb().prepare('DELETE FROM zipi_sessions WHERE token_hash = ?').run(hashToken(token));
  jar.delete(zipiSession);
  jar.delete(zipiChallenge);
  return NextResponse.json({ success: true });
}
