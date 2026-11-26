'use strict';
// fintechcorp.local - intentionally vulnerable bank for the Cynchor Fintech Range.
// Every weakness below is deliberate. See README.md for the MITRE ATT&CK mapping.
const express = require('express');
const crypto = require('node:crypto');
const { openDb, sha } = require('./db');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  // Access log to stdout (method, path, status only; no cookies or bodies). The orchestrator captures container stdout into audit_logs.
  app.use((req, res, next) => {
    res.on('finish', () => console.log(`ACCESS ${req.method} ${req.path.slice(0, 200)} ${res.statusCode}`));
    next();
  });
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Target-local session store, unrelated to the main Cynchor app's sessions.
  const sessions = new Map();
  const cookieSid = (req) => /(?:^|;\s*)fc_sid=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
  const sessionOf = (req) => sessions.get(cookieSid(req));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const needLogin = (req, res, next) => {
    const s = sessionOf(req);
    if (!s) return res.status(401).json({ error: 'login required' });
    req.user = s;
    next();
  };
  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui;background:#0b1220;color:#e6edf3;max-width:640px;margin:3rem auto}input,button{padding:.5rem;margin:.25rem 0}</style></head>
<body><h1>FintechCorp Online Banking</h1><p>fintechcorp.local</p>${body}</body></html>`;

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.get('/', (req, res) => {
    const s = sessionOf(req);
    if (s) return res.send(page('Home', `<p>Signed in as ${esc(s.username)}.</p><p>Your account: <a href="/account/${s.accountId}">/account/${s.accountId}</a></p>`));
    res.send(page('Sign in', `<form method="post" action="/login"><input name="username" placeholder="username"><br><input name="password" type="password" placeholder="password"><br><button>Sign in</button></form>`));
  });

  // VULNERABILITY 1: SQL injection in login (MITRE ATT&CK T1190).
  // This is the ONE deliberate exception in the repository to "parameterized queries only":
  // the query below concatenates user input on purpose so range players can exploit it.
  // DELIBERATELY-VULNERABLE-SQL: never copy this pattern into the main Cynchor app (src/).
  app.post('/login', (req, res) => {
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');
    const sql = "SELECT username, role FROM users WHERE username = '" + username + "' AND password_hash = '" + sha(password) + "'";
    let row;
    try {
      row = db.prepare(sql).get();
    } catch (e) {
      return res.status(500).json({ error: 'database error', detail: String(e.message) });
    }
    if (!row) return res.status(401).json({ error: 'invalid credentials' });
    const acct = db.prepare('SELECT id FROM accounts WHERE owner_username = ?').get(row.username);
    const sid = crypto.randomBytes(16).toString('hex');
    sessions.set(sid, { username: row.username, role: row.role, accountId: acct ? acct.id : null });
    res.setHeader('Set-Cookie', `fc_sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
    res.json({ ok: true, username: row.username, accountId: acct ? acct.id : null });
  });

  // VULNERABILITY 2: IDOR. Any logged-in user can read or modify any account (T1213 for reads).
  app.get('/account/:id', needLogin, (req, res) => {
    const acct = db.prepare('SELECT id, owner_username, name, balance_cents, memo FROM accounts WHERE id = ?').get(Number(req.params.id));
    if (!acct) return res.status(404).json({ error: 'not found' });
    res.json(acct);
  });
  app.post('/account/:id', needLogin, (req, res) => {
    const id = Number(req.params.id);
    const acct = db.prepare('SELECT id FROM accounts WHERE id = ?').get(id);
    if (!acct) return res.status(404).json({ error: 'not found' });
    const { name, memo, owner_username } = req.body || {};
    if (name !== undefined) db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(String(name), id);
    if (memo !== undefined) db.prepare('UPDATE accounts SET memo = ? WHERE id = ?').run(String(memo), id);
    if (owner_username !== undefined) db.prepare('UPDATE accounts SET owner_username = ? WHERE id = ?').run(String(owner_username), id);
    db.prepare('INSERT INTO transfers (from_id, to_id, amount_cents, actor, kind) VALUES (?, ?, 0, ?, ?)').run(id, id, req.user.username, 'account-edit');
    res.json(db.prepare('SELECT id, owner_username, name, balance_cents, memo FROM accounts WHERE id = ?').get(id));
  });

  // VULNERABILITY 3: flawed transfer (T1565.001). No ownership check on fromId, and the
  // balance check only runs for positive amounts, so a negative amount pulls money out
  // of toId into fromId (overdraft / money duplication from other customers).
  app.post('/transfer', needLogin, (req, res) => {
    const fromId = Number(req.body?.fromId);
    const toId = Number(req.body?.toId);
    const amount = Number(req.body?.amountCents);
    if (!Number.isInteger(fromId) || !Number.isInteger(toId) || !Number.isInteger(amount)) {
      return res.status(400).json({ error: 'fromId, toId, amountCents must be integers' });
    }
    const from = db.prepare('SELECT id, balance_cents FROM accounts WHERE id = ?').get(fromId);
    const to = db.prepare('SELECT id FROM accounts WHERE id = ?').get(toId);
    if (!from || !to) return res.status(404).json({ error: 'account not found' });
    if (amount > 0 && from.balance_cents < amount) return res.status(400).json({ error: 'insufficient funds' });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?').run(amount, fromId);
      db.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?').run(amount, toId);
      db.prepare('INSERT INTO transfers (from_id, to_id, amount_cents, actor, kind) VALUES (?, ?, ?, ?, ?)').run(fromId, toId, amount, req.user.username, 'transfer');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(500).json({ error: 'transfer failed' });
    }
    res.json({ ok: true, from: db.prepare('SELECT id, balance_cents FROM accounts WHERE id = ?').get(fromId) });
  });

  // VULNERABILITY 4: hidden back-office endpoints with no authentication at all
  // (broken access control, T1190). Unlinked from the UI; discoverable by path guessing.
  app.get('/internal/admin/accounts', (_req, res) => {
    res.json({ accounts: db.prepare('SELECT * FROM accounts ORDER BY id').all() });
  });
  app.post('/internal/admin/accounts', (req, res) => {
    const id = Number(req.body?.id);
    const bal = Number(req.body?.balance_cents);
    if (!Number.isInteger(id) || !Number.isInteger(bal)) return res.status(400).json({ error: 'id and balance_cents must be integers' });
    const r = db.prepare('UPDATE accounts SET balance_cents = ? WHERE id = ?').run(bal, id);
    if (!r.changes) return res.status(404).json({ error: 'not found' });
    res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
  });
  app.get('/internal/admin/vault', (_req, res) => {
    res.json(db.prepare('SELECT id, balance_cents FROM central_vault WHERE id = 1').get());
  });
  // Boss step 2: sweep the Central Vault into any account (T1657 Financial Theft).
  app.post('/internal/admin/vault', (req, res) => {
    const toId = Number(req.body?.toId);
    if (!Number.isInteger(toId) || !db.prepare('SELECT id FROM accounts WHERE id = ?').get(toId)) {
      return res.status(400).json({ error: 'valid toId required' });
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const v = db.prepare('SELECT balance_cents FROM central_vault WHERE id = 1').get();
      db.prepare('UPDATE central_vault SET balance_cents = 0 WHERE id = 1').run();
      db.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?').run(v.balance_cents, toId);
      db.prepare('INSERT INTO transfers (from_id, to_id, amount_cents, actor, kind) VALUES (0, ?, ?, ?, ?)').run(toId, v.balance_cents, 'internal-admin', 'vault-sweep');
      db.exec('COMMIT');
      res.json({ ok: true, movedCents: v.balance_cents, toId });
    } catch (e) {
      db.exec('ROLLBACK');
      res.status(500).json({ error: 'sweep failed' });
    }
  });

  return app;
}

function start(port, dbPath) {
  const db = openDb(dbPath);
  return createApp(db).listen(port, process.env.HOST || '0.0.0.0');
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  start(port).on('listening', () => console.log(`fintechcorp.local target listening on ${port}`));
}

module.exports = { createApp, start };
