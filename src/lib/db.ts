import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { initializeAccounts } from './account-schema';
import fs from 'fs';
import crypto from 'crypto';
import { ApplicationDatabase, createPostgresPool } from "./database";


// Path to SQLite db file
const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = process.env.CYNCHOR_DB_PATH || path.join(dbDir, 'cynchor.sqlite');

let database: DatabaseSync | null = null;

export function openLocalDatabase(): DatabaseSync {
  if (!database) {
    const next = new DatabaseSync(dbPath);
    try {
      initSchema(next);
      database = next;
    } catch (error) {
      next.close();
      throw error;
    }
  }
  return database;
}

let applicationDb: ApplicationDatabase | undefined;
export function getDb(): ApplicationDatabase {
  return applicationDb ??= process.env.CYNCHOR_DATABASE === 'postgres'
    ? new ApplicationDatabase(undefined, createPostgresPool())
    : new ApplicationDatabase(openLocalDatabase());
}

export function hashPassword(password: string, salt?: string): string {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return `${actualSalt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, originalHash] = stored.split(':');
    if (!salt || !originalHash) return false;
    const computedHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(originalHash, 'hex'));
  } catch {
    return false;
  }
}

export function hashIpAddress(ip: string = '127.0.0.1'): string {
  const salt = process.env.IP_HASH_SALT || 'cynchor-default-ip-hash-salt-2026';
  return crypto.createHmac('sha256', salt).update(ip).digest('hex').slice(0, 16);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function recordAuditLog({
  userId,
  action,
  details,
  ip = '127.0.0.1',
}: {
  userId?: string;
  action: string;
  details?: string;
  ip?: string;
}) {
  try {
    const db = getDb();
    const id = `audit_${crypto.randomUUID()}`;
    const ipHash = hashIpAddress(ip);
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, user_id, action, details, ip_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    await stmt.run(id, userId || 'ANONYMOUS', action, details || null, ipHash, now);
  } catch (err) {
    // Non-blocking log failure
    console.error('Audit log recording error:', err);
  }
}

export async function getAuditLogs(limit: number = 50) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, user_id, action, details, ip_hash, created_at
    FROM audit_logs
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return await stmt.all(limit);
}

export interface CreateClaimOptions {
  username?: string;
  purpose?: 'CLAIM' | 'RESET';
  targetUserId?: string;
  expiresInDays?: number;
}

export async function createSecureInvite(options: CreateClaimOptions = {}): Promise<{ plainToken: string; tokenHash: string; expiresAt: string }> {
  const db = getDb();
  const { username, purpose = 'CLAIM', targetUserId, expiresInDays = 7 } = options;
  // 256-bit random entropy = 32 bytes
  const plainToken = `CYN-${crypto.randomBytes(32).toString('hex').toUpperCase()}`;
  const hashed = hashToken(plainToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const id = `inv_${crypto.randomUUID()}`;
  const normalizedUsername = username ? username.toLowerCase().trim() : null;

  const stmt = db.prepare(`
    INSERT INTO invites (id, token, username, purpose, target_user_id, is_used, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `);
  await stmt.run(id, hashed, normalizedUsername, purpose, targetUserId || null, expiresAt, now.toISOString());

  await recordAuditLog({
    action: purpose === 'RESET' ? 'RESET_LINK_CREATED' : 'INVITE_CREATED',
    details: `Claim token (${purpose}) generated${normalizedUsername ? ` for ${normalizedUsername}` : ''} (256-bit token stored hashed)`,
  });

  return { plainToken, tokenHash: hashed, expiresAt };
}

export interface ClaimTokenRow {
  id: string;
  username: string | null;
  purpose: string;
  target_user_id: string | null;
  is_used: number;
  expires_at: string;
}

export async function inspectClaimToken(plainToken: string): Promise<{
  valid: boolean;
  username?: string | null;
  purpose?: 'CLAIM' | 'RESET';
  targetUserId?: string | null;
  error?: string;
}> {
  const db = getDb();
  const hashed = hashToken(plainToken);
  const row = (await db
    .prepare('SELECT id, username, purpose, target_user_id, is_used, expires_at FROM invites WHERE token = ?')
    .get(hashed)) as ClaimTokenRow | undefined;

  if (!row) {
    return { valid: false, error: 'Claim token is invalid or does not exist.' };
  }
  if (row.is_used === 1) {
    return { valid: false, error: 'This claim token has already been consumed.' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { valid: false, error: 'This claim token has expired.' };
  }

  return {
    valid: true,
    username: row.username,
    purpose: row.purpose === 'RESET' ? 'RESET' : 'CLAIM',
    targetUserId: row.target_user_id,
  };
}

export async function verifyAndConsumeInvite(plainToken: string): Promise<{
  valid: boolean;
  username?: string | null;
  purpose?: 'CLAIM' | 'RESET';
  targetUserId?: string | null;
  error?: string;
}> {
  const db = getDb();
  const hashed = hashToken(plainToken);

  const stmt = db.prepare(`
    SELECT id, username, purpose, target_user_id, is_used, expires_at
    FROM invites
    WHERE token = ?
  `);
  const row = (await stmt.get(hashed)) as ClaimTokenRow | undefined;

  if (!row) {
    return { valid: false, error: 'Claim token is invalid or does not exist.' };
  }

  if (row.is_used === 1) {
    return { valid: false, error: 'This claim token has already been consumed.' };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { valid: false, error: 'This claim token has expired.' };
  }

  // Consume token
  const consumeStmt = db.prepare(`
    UPDATE invites
    SET is_used = 1, used_at = ?
    WHERE id = ? AND is_used = 0
  `);
  const consumed = await consumeStmt.run(new Date().toISOString(), row.id);

  if (!consumed.changes) return { valid: false, error: 'This claim token has already been consumed.' };
  await recordAuditLog({
    action: row.purpose === 'RESET' ? 'RESET_LINK_CONSUMED' : 'INVITE_CONSUMED',
    details: `Token consumed (${row.purpose || 'CLAIM'})${row.username ? ` for ${row.username}` : ''}`,
  });

  return {
    valid: true,
    username: row.username,
    purpose: row.purpose === 'RESET' ? 'RESET' : 'CLAIM',
    targetUserId: row.target_user_id,
  };
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    
    CREATE TABLE IF NOT EXISTS disclaimers (
      id TEXT PRIMARY KEY,
      accepted_at TEXT NOT NULL,
      user_identifier TEXT NOT NULL,
      ip_address TEXT,
      version TEXT DEFAULT 'v1.1'
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      side TEXT NOT NULL,
      leader_id TEXT NOT NULL,
      is_complete INTEGER DEFAULT 0,
      status TEXT DEFAULT 'RECRUITING',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS matchmaking_queue (
      id TEXT PRIMARY KEY,
      team_id TEXT UNIQUE,
      side TEXT NOT NULL,
      status TEXT DEFAULT 'WAITING',
      joined_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS match_sessions (
      id TEXT PRIMARY KEY,
      red_team_id TEXT,
      blue_team_id TEXT,
      mode TEXT NOT NULL,
      side TEXT,
      user_id TEXT,
      lab_id TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS level_progress (
      username TEXT NOT NULL,
      level_id INTEGER NOT NULL,
      unlocked_at TEXT NOT NULL,
      completed_at TEXT,
      best_score INTEGER DEFAULT 0,
      PRIMARY KEY (username, level_id)
    );

    CREATE TABLE IF NOT EXISTS range_scores (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      level_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      side TEXT NOT NULL,
      score INTEGER NOT NULL,
      vault_remaining INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Try migrating audit_logs columns if table was created in older schema
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
  `);
  try {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN user_id TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN ip_hash TEXT;`);
  } catch {}

  initializeAccounts(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS zipi_operators (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, secret TEXT NOT NULL,
      last_counter INTEGER NOT NULL DEFAULT -1, attempts INTEGER NOT NULL DEFAULT 0,
      window_end INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS zipi_challenges (
      token_hash TEXT PRIMARY KEY, operator_id TEXT NOT NULL UNIQUE REFERENCES zipi_operators(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS zipi_sessions (
      token_hash TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES zipi_operators(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS product_access_mail (
    request_id TEXT PRIMARY KEY REFERENCES access_requests(id),
    applicant_name TEXT NOT NULL, reply_email TEXT NOT NULL,
    next_attempt INTEGER NOT NULL DEFAULT 0, accepted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS pending_product_mail ON product_access_mail(next_attempt) WHERE accepted_at IS NULL;`);

  // Fintech Ranges extensions on matchmaking_queue and match_sessions
  const rangeAlterStatements = [
    `ALTER TABLE matchmaking_queue ADD COLUMN level_id INTEGER;`,
    `ALTER TABLE matchmaking_queue ADD COLUMN user_id TEXT;`,
    `ALTER TABLE matchmaking_queue ADD COLUMN username TEXT;`,
    `ALTER TABLE matchmaking_queue ADD COLUMN roe_accepted INTEGER DEFAULT 0;`,
    `ALTER TABLE match_sessions ADD COLUMN level_id INTEGER;`,
    `ALTER TABLE match_sessions ADD COLUMN red_username TEXT;`,
    `ALTER TABLE match_sessions ADD COLUMN blue_username TEXT;`,
    `ALTER TABLE match_sessions ADD COLUMN vault_balance INTEGER DEFAULT 10000000;`,
    `ALTER TABLE match_sessions ADD COLUMN red_score INTEGER DEFAULT 0;`,
    `ALTER TABLE match_sessions ADD COLUMN blue_score INTEGER DEFAULT 0;`,
    `ALTER TABLE match_sessions ADD COLUMN winner TEXT;`,
    `ALTER TABLE match_sessions ADD COLUMN container_id TEXT;`,
    `ALTER TABLE match_sessions ADD COLUMN network_id TEXT;`,
    `ALTER TABLE match_sessions ADD COLUMN target_host TEXT;`,
    `ALTER TABLE match_sessions ADD COLUMN target_port INTEGER;`,
    `ALTER TABLE match_sessions ADD COLUMN expires_at TEXT;`,
    `ALTER TABLE match_sessions ADD COLUMN ended_at TEXT;`,
    `ALTER TABLE match_sessions ADD COLUMN summary_json TEXT;`,
    `ALTER TABLE match_sessions ADD COLUMN roe_accepted_red INTEGER DEFAULT 0;`,
    `ALTER TABLE match_sessions ADD COLUMN roe_accepted_blue INTEGER DEFAULT 0;`,
  ];
  for (const sql of rangeAlterStatements) {
    try {
      db.exec(sql);
    } catch {}
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
  `);

  // Retire only the fixed IDs shipped by the old development seeder.
  const demoIds = "('user_op_001','user_red_001','user_blue_001','user_netsec_001','user_new_001')";
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      DELETE FROM invites WHERE id = 'inv_demo_1' OR target_user_id IN ${demoIds};
      DELETE FROM team_members WHERE user_id IN ${demoIds};
      UPDATE teams SET leader_id = (
        SELECT user_id FROM team_members WHERE team_id = teams.id ORDER BY joined_at, id LIMIT 1
      ) WHERE leader_id IN ${demoIds} AND EXISTS (SELECT 1 FROM team_members WHERE team_id = teams.id);
      DELETE FROM matchmaking_queue WHERE user_id IN ${demoIds}
        OR team_id IN (SELECT id FROM teams WHERE leader_id IN ${demoIds});
      DELETE FROM teams WHERE leader_id IN ${demoIds};
      DELETE FROM users WHERE id IN ${demoIds};
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function endMatch(sessionId: string): Promise<boolean> {
  const db = getDb();
  const row = (await db.prepare("SELECT red_team_id, blue_team_id FROM match_sessions WHERE id = ? AND status = 'ACTIVE'").get(sessionId)) as { red_team_id: string; blue_team_id: string } | undefined;
  if (row === undefined) return false;
  await db.transaction(async () => {
    await db.prepare("UPDATE match_sessions SET status = 'ENDED' WHERE id = ?").run(sessionId);
    await db.prepare('DELETE FROM matchmaking_queue WHERE team_id IN (?, ?)').run(row.red_team_id, row.blue_team_id);
    await db.prepare("UPDATE teams SET status = 'RECRUITING' WHERE id IN (?, ?) AND status = 'MATCHED'").run(row.red_team_id, row.blue_team_id);
  });
  await recordAuditLog({ action: 'MATCH_ENDED', details: `Match ${sessionId} ended` });
  return true;
}

export async function endStaleMatches(maxHours: number = 4): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxHours * 3600 * 1000).toISOString();
  const stale = (await db.prepare("SELECT id FROM match_sessions WHERE status = 'ACTIVE' AND created_at < ?").all(cutoff)) as Array<{ id: string }>;
  for (const s of stale) await endMatch(s.id);
  return stale.length;
}
