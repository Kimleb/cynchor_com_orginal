import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { request } from './request';
import { POST as claim } from '../../src/app/api/auth/claim/route';
import { POST as login } from '../../src/app/api/auth/login/route';
import { getDb, createSecureInvite } from '../../src/lib/db';
import { initializeAccounts } from '../../src/lib/account-schema';

const expected = ['id', 'username', 'password_hash', 'role', 'experience_level',
  'is_profile_completed', 'is_operator', 'created_at', 'session_version'].sort();

test('claim form asks only for credentials, claim stores only account fields and login works immediately', async () => {
  const form = readFileSync('src/app/demo/claim/[token]/ClaimForm.tsx', 'utf8');
  const labels = Array.from(form.matchAll(/<label\b[^>]*>([^<]+)<\/label>/g), match => match[1].trim());
  assert.deepEqual(labels, ['Username (Callsign)', 'Password', 'Confirm Password']);
  assert.equal((form.match(/<input\b/g) ?? []).length, 3);
  const credentials = { username: 'claim_fixture', password: 'FixturePassword!' };
  const token = (await createSecureInvite({ username: credentials.username })).plainToken;
  const payload = { token, ...credentials, email: 'unused@example.invalid', phone: 'unused-number' };
  assert.equal((await request(claim, payload)).response.status, 200);
  assert.equal((await request(login, credentials)).response.status, 200);
  const db = getDb();
  assert.deepEqual((await db.prepare('PRAGMA table_info(users)').all()).map(c => c.name).sort(), expected);
  const row = (await db.prepare('SELECT * FROM users WHERE username = ?').get(credentials.username))!;
  assert.deepEqual(Object.keys(row).sort(), expected);
  assert.doesNotMatch(JSON.stringify(row), /unused|FixturePassword/);
  const events = await db.prepare('SELECT * FROM audit_logs WHERE user_id = ?').all(credentials.username);
  assert.ok(events.some(event => event.action === 'ACCOUNT_CLAIMED'));
  assert.doesNotMatch(JSON.stringify(events), /unused|FixturePassword/);
});

test('legacy schema is migrated atomically, preserves account relationships and redacts historical audit data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL, session_version INTEGER NOT NULL);
      INSERT INTO users VALUES ('u1','legacy@example.invalid','Legacy','existing-hash','then',4);
      CREATE TABLE members (user_id TEXT REFERENCES users(id));
      INSERT INTO members VALUES ('u1');
      CREATE TABLE audit_logs (user_id TEXT, details TEXT, action TEXT);
      INSERT INTO audit_logs VALUES ('legacy@example.invalid','User legacy@example.invalid','LOGIN_FAILED');
      CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'append-only'); END;`);
    initializeAccounts(db);
    initializeAccounts(db);
    assert.deepEqual(db.prepare('PRAGMA table_info(users)').all().map(c => c.name).sort(), expected);
    const row = db.prepare('SELECT * FROM users').get()!;
    assert.match(String(row.username), /^acct_[a-f0-9]+$/);
    assert.equal(row.id, 'u1');
    assert.equal(row.password_hash, 'existing-hash');
    assert.equal(row.session_version, 4);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('SELECT count(*) AS n FROM members JOIN users ON users.id = members.user_id').get()?.n, 1);
    assert.equal(db.prepare('SELECT details FROM audit_logs').get()?.details, null);
    assert.throws(() => db.exec("UPDATE audit_logs SET details='x'"), /append-only/);
  } finally {
    db.close();
  }
});
