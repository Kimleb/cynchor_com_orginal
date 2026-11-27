import crypto from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { z } from 'zod';
import { getDb } from './db';

export const staffEmail = z.string().trim().toLowerCase().max(254).email().regex(/@cynchor\.com$/);
const parameters = { issuer: 'Cynchor', algorithm: 'SHA1', digits: 6, period: 30 };

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('A stable SESSION_SECRET is required');
  return crypto.createHmac('sha256', secret).update('zipi authenticator encryption v1').digest();
}

export async function enroll(emailInput: string) {
  const email = staffEmail.parse(emailInput);
  const secret = new Secret({ size: 20 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(email));
  const encrypted = Buffer.concat([cipher.update(secret.base32, 'utf8'), cipher.final()]);
  const stored = [iv, encrypted, cipher.getAuthTag()].map(part => part.toString('base64')).join('.');
  await getDb().prepare('INSERT INTO zipi_operators (id, email, secret) VALUES (?, ?, ?)').run(crypto.randomUUID(), email, stored);
  return secret.base32;
}

export async function verifyAuthenticator(email: string, code: string) {
  const db = getDb();
  const now = Date.now();
  const row = await db.prepare(`UPDATE zipi_operators SET
    attempts = CASE WHEN window_end <= ? THEN 1 ELSE attempts + 1 END,
    window_end = CASE WHEN window_end <= ? THEN ? ELSE window_end END
    WHERE email = ? AND (attempts < 5 OR window_end <= ?) RETURNING id, secret`)
    .get(now, now, now + 300000, email, now);
  if (!row) return null;
  const [iv, ciphertext, tag] = String(row.secret).split('.').map(part => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAAD(Buffer.from(email));
  decipher.setAuthTag(tag);
  const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString();
  const delta = new TOTP({ ...parameters, secret }).validate({ token: code, timestamp: now, window: 1 });
  if (delta === null) return null;
  const counter = Math.floor(now / 30000) + delta;
  const consumed = await db.prepare('UPDATE zipi_operators SET last_counter = ?, attempts = 0 WHERE id = ? AND last_counter < ?')
    .run(counter, row.id, counter);
  return consumed.changes ? String(row.id) : null;
}
