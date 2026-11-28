import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from './request';
import { TOTP } from 'otpauth';
import { enroll } from '../../src/lib/zipi-factors';
import { POST, DELETE } from '../../src/app/api/zipi/auth/route';
import { GET as consoleData } from '../../src/app/api/zipi/route';
import { getDb, hashPassword } from '../../src/lib/db';
import { POST as login } from '../../src/app/api/auth/login/route';

test('console requires both one-time factors from the same enrollment and browser', async t => {
  const email = 'fixture@cynchor.com';
  const totp = new TOTP({ secret: await enroll(email) });
  const start = (address: string, code: string) => request(POST, { step: 'start', email: address, code }, '', '192.0.2.9', 'cynchor_zipi_challenge');
  const finish = (code: string, cookie: string) => request(POST, { step: 'verify', code }, cookie, '192.0.2.9', 'cynchor_zipi');
  process.env.RESEND_API_KEY = 'test';
  process.env.ZIPI_EMAIL_FROM = 'sender@example.invalid';
  let emailCode = '';
  const send = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const mail = JSON.parse(String(init.body));
    assert.deepEqual(mail.to, [email]);
    emailCode = mail.text.match(/code is (\d{6})/)[1];
    return Response.json({ id: 'accepted' });
  });
  const code = totp.generate();
  assert.equal((await start('a@othercynchor.com', code)).response.status, 401);
  assert.equal((await start('unknown@cynchor.com', code)).response.status, 401);
  assert.equal((await request(POST, {email, password: 'password'})).response.status, 401);
  assert.equal(send.mock.callCount(), 0);
  const first = await start(email.toUpperCase(), code);
  assert.equal(first.response.status, 200);
  assert.ok(first.cookie?.httpOnly);
  assert.equal((await start(email, code)).response.status, 401);
  const challenge = first.cookie.name + '=' + first.cookie.value;
  assert.equal((await request(consoleData, undefined, challenge)).response.status, 403);
  assert.equal((await finish(emailCode, '')).response.status, 401);
  const wrong = emailCode === '000000' ? '000001' : '000000';
  assert.equal((await finish(wrong, challenge)).response.status, 401);
  const verified = await finish(emailCode, challenge);
  assert.equal(verified.response.status, 200);
  assert.ok(verified.cookie?.httpOnly);
  const session = verified.cookie.name + '=' + verified.cookie.value;
  assert.equal((await finish(emailCode, challenge)).response.status, 401);
  assert.equal((await request(consoleData, undefined, session)).response.status, 200);
  assert.equal((await request(DELETE, {}, session)).response.status, 200);
  assert.equal((await request(consoleData, undefined, session)).response.status, 403);
  assert.equal(send.mock.callCount(), 1);
});

test('mail delivery failure removes the pending challenge and issues no session', async t => {
  const email = 'delivery@cynchor.com';
  const secret = await enroll(email);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  const result = await request(POST, { step: 'start', email, code: new TOTP({ secret }).generate() });
  assert.equal(result.response.status, 503);
  assert.equal((await getDb().prepare('SELECT count(*) AS n FROM zipi_challenges').get())?.n, 0);
});

test('a valid legacy operator password session grants no console access', async () => {
  const password = 'Isolated-test-password';
  await getDb().prepare(`INSERT INTO users (id, username, password_hash, is_operator, created_at)
    VALUES ('fixture_zipi_legacy', 'zipi_legacy', ?, 1, ?)`).run(hashPassword(password), new Date().toISOString());
  const player = await request(login, { username: 'zipi_legacy', password });
  assert.equal(player.response.status, 200);
  assert.ok(player.cookie);
  const cookie = player.cookie.name + '=' + player.cookie.value;
  assert.equal((await request(consoleData, undefined, cookie)).response.status, 403);
});

test('an enrollment encrypted with a different secret fails without opening a session', async t => {
  const email = 'secret-mismatch@cynchor.com';
  const secret = await enroll(email);
  const original = process.env.SESSION_SECRET;
  const log = t.mock.method(console, 'error', () => {});
  process.env.SESSION_SECRET = 'different-test-secret-at-least-32-characters';
  try {
    const { response, cookie } = await request(POST, {
      step: 'start', email, code: new TOTP({ secret }).generate(),
    }, '', '192.0.2.80', 'cynchor_zipi_challenge');
    assert.equal(response.status, 503);
    assert.equal(cookie, undefined);
    assert.deepEqual(log.mock.calls[0]?.arguments[1], {
      step: 'start', code: 'ZIPI_ENROLLMENT_DECRYPT_FAILED',
    });
  } finally {
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
  }
});
