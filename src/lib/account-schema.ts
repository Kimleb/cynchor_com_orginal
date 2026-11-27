import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { usernameSchema } from './validators';

const schemas = {
  users: `id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT, experience_level TEXT, is_profile_completed INTEGER DEFAULT 0,
    is_operator INTEGER DEFAULT 0, created_at TEXT NOT NULL, session_version INTEGER NOT NULL DEFAULT 0`,
  access_requests: `id TEXT PRIMARY KEY, note TEXT, status TEXT DEFAULT 'PENDING',
    source TEXT NOT NULL DEFAULT 'demo', created_at TEXT NOT NULL, approved_at TEXT,
    claim_token_hash TEXT, generated_invite_token TEXT`,
  invites: `id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, username TEXT,
    purpose TEXT NOT NULL DEFAULT 'CLAIM', target_user_id TEXT, is_used INTEGER DEFAULT 0,
    used_at TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL`,
};

type AccountTable = keyof typeof schemas;

function columns(db: DatabaseSync, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
}

const seedHandles: Record<string, string> = {
  user_op_001: 'operator', user_red_001: 'alex_red', user_blue_001: 'sarah_blue',
  user_netsec_001: 'jordan_netsec', user_new_001: 'newuser',
};

function migrateHandles(db: DatabaseSync, hasUsername: boolean) {
  if (!hasUsername) db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  const rows = db.prepare('SELECT id, username FROM users ORDER BY id').all();
  const reserved = new Set(rows.map(row => row.username));
  const update = db.prepare('UPDATE users SET username = ? WHERE id = ?');
  for (const row of rows) {
    const parsed = usernameSchema.safeParse(row.username);
    if (parsed.success && parsed.data === row.username) continue;
    let handle = parsed.success ? parsed.data : seedHandles[String(row.id)];
    while (!handle || reserved.has(handle)) handle = 'acct_' + randomBytes(7).toString('hex');
    reserved.add(handle);
    update.run(handle, row.id);
  }
}

export function initializeAccounts(db: DatabaseSync) {
  // Rebuild referenced tables under a write lock. Foreign key enforcement must
  // be changed outside the transaction and restored after checking the copy.
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
  try {
    let upgraded = false;
    for (const table of Object.keys(schemas) as AccountTable[]) {
      const definition = schemas[table];
      const original = columns(db, table);
      if (!original.length) {
        db.exec(`CREATE TABLE ${table} (${definition})`);
        continue;
      }
      if (!original.includes('email') && !original.includes('name')) continue;
      upgraded = true;
      if (table === 'users') migrateHandles(db, original.includes('username'));
      db.exec(`CREATE TABLE new_${table} (${definition})`);
      const existing = columns(db, table);
      const shared = columns(db, 'new_' + table).filter(col => existing.includes(col)).join(', ');
      db.exec(`INSERT INTO new_${table} (${shared}) SELECT ${shared} FROM ${table}`);
      if (table === 'invites' && original.includes('email')) {
        // A formerly email-bound token must never become an unrestricted claim.
        db.exec('UPDATE new_invites SET is_used = 1 WHERE id IN (SELECT id FROM invites WHERE email IS NOT NULL)');
      }
      db.exec(`DROP TABLE ${table}; ALTER TABLE new_${table} RENAME TO ${table}`);
    }
    if (upgraded) {
      // One-time redaction while exclusively holding the writer lock. Keep
      // event IDs, actions, timestamps and integrity triggers across migration.
      db.exec(`DROP TRIGGER IF EXISTS audit_logs_no_update;
        UPDATE audit_logs SET details = NULL WHERE instr(details, '@') > 0 OR action = 'RATE_LIMIT_LOCKOUT';
        UPDATE audit_logs SET user_id = 'ANONYMOUS' WHERE instr(user_id, '@') > 0;
        UPDATE audit_logs SET user_id = (SELECT username FROM users WHERE users.id = audit_logs.user_id)
          WHERE EXISTS (SELECT 1 FROM users WHERE users.id = audit_logs.user_id);
        CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
          BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;`);
      if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Account migration failed referential integrity check');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
