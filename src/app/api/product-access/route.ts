import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/session';

import { getDb } from '@/lib/db';
import { deliverProductMail } from '@/lib/product-access-mail';

const application = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().max(254).email(),
  message: z.string().trim().min(1).max(500),
  requestId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.ip || 'local';
  const limit = checkRateLimit(`product-access_${ip}`, 5, 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, {
      status: 429, headers: { 'Retry-After': String(limit.retryAfter ?? 60) },
    });
  }
  const parsed = application.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a name, valid email and a message of up to 500 characters.' }, { status: 400 });
  }
  const { name, email, message, requestId } = parsed.data;
  const db = getDb();
  try {
    const conflict = await db.transaction(async () => {
      const existing = await db.prepare(`SELECT applicant_name, reply_email, note FROM product_access_mail
        JOIN access_requests ON id = request_id WHERE request_id = ?`).get(requestId);
      if (existing && (existing.applicant_name !== name || existing.reply_email !== email || existing.note !== message)) {
        return true;
      }
      if (!existing) {
        await db.prepare(`INSERT INTO access_requests (id, note, source, created_at) VALUES (?, ?, 'product', ?)`)
          .run(requestId, message, new Date().toISOString());
        await db.prepare('INSERT INTO product_access_mail (request_id, applicant_name, reply_email) VALUES (?, ?, ?)')
          .run(requestId, name, email);
      }
      return false;
    });
    if (conflict) return NextResponse.json({ error: 'Please refresh and submit your updated request.' }, { status: 409 });
  } catch {
    return NextResponse.json({ error: 'Your request could not be saved. Please try again.' }, { status: 503 });
  }
  await deliverProductMail(requestId);
  return NextResponse.json({ success: true });
}
