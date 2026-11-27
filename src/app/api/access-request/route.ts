import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/session';
import { getDb, recordAuditLog } from '@/lib/db';
import { accessRequestSchema } from '@/lib/validators';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.ip || '127.0.0.1';
    const rl = checkRateLimit(`public_${ip}`, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
      );
    }
    const body = await req.json().catch(() => ({}));
    const parseResult = accessRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: parseResult.error.issues?.[0]?.message || 'Invalid request input.' },
        { status: 400 }
      );
    }

    const { note = '', source = 'demo', website } = parseResult.data;

    // Honeypot check: if website filled, return success silently without inserting
    if (website && website.length > 0) {
      return NextResponse.json({
        success: true,
        message: "Thanks — we'll reach out with your access details.",
      });
    }

    const db = getDb();
    const id = `req_${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO access_requests (id, note, status, source, created_at)
      VALUES (?, ?, 'PENDING', ?, ?)
    `);

    await stmt.run(id, note || null, source, createdAt);

    await recordAuditLog({
      action: 'ACCESS_REQUEST_SUBMITTED',
      details: `Access request submitted (id: ${id}, source: ${source})`,
      ip,
    });

    return NextResponse.json({
      success: true,
      message: "Thanks — we'll reach out with your access details.",
    });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ success: false, error: 'Internal error.' }, { status: 500 });
  }
}
