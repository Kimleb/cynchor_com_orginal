import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb, recordAuditLog } from '../src/lib/db';

test('audit_logs rejects UPDATE and DELETE (append-only triggers)', async () => {
  const action = `APPEND_ONLY_${Date.now()}`;
  await recordAuditLog({ userId: 'test', action, details: 'x', ip: '198.51.100.7' });
  const db = getDb();
  await assert.rejects(async () => (await db.prepare('UPDATE audit_logs SET details = ? WHERE action = ?').run('tamper', action)), /append-only/);
  await assert.rejects(async () => (await db.prepare('DELETE FROM audit_logs WHERE action = ?').run(action)), /append-only/);
});
