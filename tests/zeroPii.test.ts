import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, createSecureInvite, hashPassword } from '../src/lib/db';

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      out.push(full);
    }
  }
  return out;
}

test('Zero-PII Schema: no legacy personal columns and new write paths work without PII', async () => {
  const db = getDb();

  const userCols = (await db.prepare('PRAGMA table_info(users)').all()) as TableInfoRow[];
  const reqCols = (await db.prepare('PRAGMA table_info(access_requests)').all()) as TableInfoRow[];
  const invCols = (await db.prepare('PRAGMA table_info(invites)').all()) as TableInfoRow[];

  assert.ok(userCols.some((c) => c.name === 'username'), 'users must have username column');
  for (const cols of [userCols, reqCols, invCols]) {
    assert.ok(cols.every(c => c.name !== 'email' && c.name !== 'name'));
  }

  // Verify new write paths succeed with zero PII
  const uid = `user_zp_${Date.now()}`;
  const uname = `zp_${Date.now().toString().slice(-6)}`;
  const now = new Date().toISOString();

  await db.prepare(
    'INSERT INTO users (id, username, password_hash, is_profile_completed, is_operator, created_at) VALUES (?, ?, ?, 0, 0, ?)'
  ).run(uid, uname, hashPassword('ZeroPiiPass2026!'), now);

  const insertedUser = (await db.prepare('SELECT username FROM users WHERE id = ?').get(uid)) as {
    username: string;
  };
  assert.equal(insertedUser.username, uname);

  const reqId = `req_zp_${crypto.randomUUID()}`;
  await db.prepare("INSERT INTO access_requests (id, note, status, source, created_at) VALUES (?, ?, 'PENDING', 'demo', ?)").run(
    reqId,
    'Interested in red team lab',
    now
  );
  const insertedReq = (await db.prepare('SELECT note FROM access_requests WHERE id = ?').get(reqId)) as {
    note: string;
  };
  assert.equal(insertedReq.note, 'Interested in red team lab');

  const { tokenHash } = await createSecureInvite({ username: uname });
  const insertedInv = (await db.prepare('SELECT username FROM invites WHERE token = ?').get(tokenHash)) as {
    username: string | null;
  };
  assert.equal(insertedInv.username, uname);
});

test('Zero-PII Source Scan: no src/**/*.ts(x) references user/request/invite email outside legacy migration', () => {
  const srcDir = path.join(process.cwd(), 'src');
  const files = walkTsFiles(srcDir);

  const forbiddenPatterns = [
    /\buser\.email\b/,
    /\bu\.email\b/,
    /\breq\.email\b/,
    /\binv\.email\b/,
    /\binvite\.email\b/,
    /\breq\.body\.email\b/,
    /\bbody\.email\b/,
    /INSERT\s+INTO\s+users\s*\([^)]*\bemail\b/i,
    /INSERT\s+INTO\s+access_requests\s*\([^)]*\bemail\b/i,
    /INSERT\s+INTO\s+invites\s*\([^)]*\bemail\b/i,
  ];

  const violations: string[] = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pat of forbiddenPatterns) {
        if (pat.test(line)) {
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], `Found forbidden PII references:\n${violations.join('\n')}`);
});
