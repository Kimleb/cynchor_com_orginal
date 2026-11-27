import { cookies } from 'next/headers';
import { getDb, hashToken } from './db';

export const zipiSession = 'cynchor_zipi';
export const zipiChallenge = 'cynchor_zipi_challenge';
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/' };

export async function getZipiOperator() {
  const token = cookies().get(zipiSession)?.value;
  if (!token) return null;
  const row = await getDb().prepare(`SELECT o.id FROM zipi_sessions s JOIN zipi_operators o ON s.operator_id = o.id
    WHERE s.token_hash = ? AND s.expires > ?`).get(hashToken(token), Date.now());
  return row ? { id: String(row.id), username: String(row.id) } : null;
}
