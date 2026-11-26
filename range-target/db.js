'use strict';
// Target-app database (node:sqlite). Synthetic data only: no emails, no PII.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const VAULT_START_CENTS = 50000000; // $500,000.00
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer'
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_username TEXT NOT NULL,
      name TEXT NOT NULL,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      memo TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS central_vault (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      balance_cents INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER, to_id INTEGER, amount_cents INTEGER NOT NULL,
      actor TEXT NOT NULL, kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seed(db) {
  if (process.env.NODE_ENV === 'production') return;
  if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return;
  const u = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  u.run('alex', sha('alex-pass-4821'), 'customer');
  u.run('jordan', sha('jordan-pass-7730'), 'customer');
  u.run('guest', sha('guest'), 'customer'); // the foothold account players start with
  u.run('svc_treasury', sha('not-guessable-9f3a77c1e2'), 'service');
  const a = db.prepare('INSERT INTO accounts (id, owner_username, name, balance_cents, memo) VALUES (?, ?, ?, ?, ?)');
  a.run(1, 'alex', 'Alex Vance', 124000, '');
  a.run(2, 'jordan', 'Jordan Reyes', 873050, '');
  a.run(3, 'guest', 'Guest Checking', 2500, '');
  a.run(4, 'svc_treasury', 'Treasury Operations', 0,
    'Ops note: vault sweeps are handled by the back-office tool at /internal/admin/vault (no login needed on the internal network).');
  db.prepare('INSERT INTO central_vault (id, balance_cents) VALUES (1, ?)').run(VAULT_START_CENTS);
}

function openDb(path) {
  const db = new DatabaseSync(path || process.env.RANGE_DB_PATH || ':memory:');
  initSchema(db);
  seed(db);
  return db;
}

module.exports = { openDb, initSchema, seed, sha, VAULT_START_CENTS };
