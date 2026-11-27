import { getDb } from './db';

export async function deliverProductMail(id?: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ACCESS_REQUEST_FROM;
  if (!key || !from) return;
  const db = getDb();
  const now = Date.now();
  // Claim one row atomically. A stopped process releases its lease after a minute.
  const row = await db.prepare(`UPDATE product_access_mail SET next_attempt = ? WHERE request_id = (
    SELECT request_id FROM product_access_mail WHERE accepted_at IS NULL AND next_attempt <= ?
    AND (CAST(? AS TEXT) IS NULL OR request_id = ?) ORDER BY next_attempt, request_id LIMIT 1
  ) AND accepted_at IS NULL AND next_attempt <= ? RETURNING request_id, applicant_name, reply_email`).get(now + 60000, now, id ?? null, id ?? null, now);
  if (!row) return;
  const request = await db.prepare('SELECT note FROM access_requests WHERE id = ?').get(row.request_id);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'product-access/' + row.request_id },
      body: JSON.stringify({
        from, to: ['contact@cynchor.com'], reply_to: row.reply_email, subject: 'Cynchor product access request',
        text: `Name: ${row.applicant_name}\nEmail: ${row.reply_email}\n\n${request?.note}`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok && (await response.json()).id) {
      await db.prepare('UPDATE product_access_mail SET accepted_at = ? WHERE request_id = ?').run(Date.now(), row.request_id);
    }
  } catch {
    // The durable row stays pending for the backend retry.
  }
}
