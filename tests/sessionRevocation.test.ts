import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/lib/db';
import { revokeUserSessions } from '../src/lib/session';

test('revokeUserSessions increments session_version', async () => {
  const db = getDb();
  const id = `user_test_${Date.now()}`;
  await db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'x', ?)").run(id, `u_${Date.now().toString().slice(-8)}`, new Date().toISOString());
  const read = async () => ((await db.prepare('SELECT session_version AS v FROM users WHERE id = ?').get(id)) as { v: number }).v;
  const before = await read();
  await revokeUserSessions(id);
  assert.equal(await read(), before + 1);
});
