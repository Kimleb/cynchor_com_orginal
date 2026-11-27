import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from './request';
import { POST as login } from '../../src/app/api/auth/login/route';
import { GET as currentUser } from '../../src/app/api/auth/me/route';

import { randomUUID } from 'node:crypto';
import { getDb, hashPassword, hashToken } from '../../src/lib/db';
import { POST as logout } from '../../src/app/api/auth/logout/route';

const valid = { username: 'login_' + randomUUID().slice(0, 8), password: randomUUID() };
test.before(async () => {
  await getDb().prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), valid.username, hashPassword(valid.password), new Date().toISOString());
});
const wrong = { ...valid, password: 'Incorrect-fixture!' };

test('correct credentials set a persistent cookie and the same session expires after seven days', async t => {
  const result = await request(login, valid);
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie?.httpOnly);
  assert.equal(result.cookie.sameSite, 'lax');
  assert.equal(result.cookie.path, '/');
  const header = result.cookie.name + '=' + result.cookie.value;
  for (let i = 0; i < 2; i++) {
    const { response } = await request(currentUser, undefined, header);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.username, valid.username);
  }
  t.mock.method(Date, 'now', () => new Date().getTime() + 8 * 86400000);
  assert.equal((await request(currentUser, undefined, header)).response.status, 401);
  assert.equal((await request(login, valid, header)).response.status, 200);
});

test('wrong password and unknown handle return identical generic responses', async () => {
  const first = await request(login, wrong);
  const second = await request(login, { ...wrong, username: 'nobody_here' });
  for (const { response, cookie } of [first, second]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { success: false, error: 'Invalid username or password.' });
    assert.equal(cookie, undefined);
  }
});

test('success resets counters, failed logins lock the handle across IPs until timeout', async t => {
  for (let i = 0; i < 8; i++) assert.equal((await request(login, valid)).response.status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await request(login, wrong)).response.status, 401);
  const locked = await request(login, valid, '', '192.0.2.2');
  assert.equal(locked.response.status, 429);
  assert.equal(locked.response.headers.get('retry-after'), '300');
  t.mock.method(Date, 'now', () => new Date().getTime() + 301000);
  assert.equal((await request(login, valid)).response.status, 200);
});

test('IP login limit also covers attempts against different handles', async () => {
  for (let i = 0; i < 5; i++) {
    assert.equal((await request(login, { ...wrong, username: 'missing_' + i }, '', '192.0.2.3')).response.status, 401);
  }
  assert.equal((await request(login, valid, '', '192.0.2.3')).response.status, 429);
});

test('session is saved by hash and logout invalidates its cookie', async () => {
  const { cookie } = await request(login, valid, '', '192.0.2.7');
  assert.ok(cookie);
  const header = cookie.name + '=' + cookie.value;
  const stored = getDb().prepare('SELECT expires_at FROM auth_sessions WHERE token_hash = ?');
  assert.ok(await stored.get(hashToken(cookie.value)));
  assert.equal((await request(logout, {}, header)).response.status, 200);
  assert.equal(await stored.get(hashToken(cookie.value)), undefined);
  assert.equal((await request(currentUser, undefined, header)).response.status, 401);
});

test('forgot password queues one operator request and reset preserves the account and its saved progress', async () => {
  const { POST: forgot } = await import('../../src/app/api/auth/forgot-password/route');
  const { POST: claim } = await import('../../src/app/api/auth/claim/route');
  const { createSecureInvite } = await import('../../src/lib/db');
  const db = getDb();
  const user = await db.prepare('SELECT id FROM users WHERE username = ?').get(valid.username);
  assert.ok(user);
  const id = String(user.id);
  const oldSession = await request(login, valid, '', '192.0.2.8');
  assert.ok(oldSession.cookie);
  const oldCookie = oldSession.cookie.name + '=' + oldSession.cookie.value;
  await db.prepare("UPDATE users SET role = 'BLUE_TEAM', is_profile_completed = 1 WHERE id = ?").run(id);
  const { completeLevelForUser, getUserLevelProgress } = await import('../../src/lib/range-progress');
  await completeLevelForUser(valid.username, 1, 50);
  await completeLevelForUser(valid.username, 1, 30);

  const requested = await request(forgot, { username: valid.username });
  const unknown = await request(forgot, { username: 'missing_fixture' });
  assert.equal(requested.response.status, 200);
  assert.equal(unknown.response.status, 200);
  assert.deepEqual(await requested.response.json(), await unknown.response.json());
  assert.equal((await request(forgot, { username: valid.username })).response.status, 200);
  const queue = await db.prepare("SELECT id FROM access_requests WHERE source = 'password-reset' AND id = ?").all('reset_' + id);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 'reset_' + id);

  const token = (await createSecureInvite({ purpose: 'RESET', targetUserId: id })).plainToken;
  const password = randomUUID();
  const reset = await request(claim, { token, password });
  assert.equal(reset.response.status, 200);
  assert.equal((await reset.response.json()).redirectTo, '/demo/dashboard');
  assert.equal((await request(claim, { token, password })).response.status, 400);
  assert.equal((await request(currentUser, undefined, oldCookie)).response.status, 401);
  assert.equal((await request(login, valid, '', '192.0.2.8')).response.status, 401);
  const fresh = await request(login, { username: valid.username, password }, '', '192.0.2.8');
  assert.equal(fresh.response.status, 200);
  assert.equal((await fresh.response.json()).user.id, id);
  const progress = await getUserLevelProgress(valid.username);
  assert.equal(progress.find(level => level.levelId === 1)?.bestScore, 50);
});

test('invalid JSON returns 400 and rejoining a one-person squad preserves it', async () => {
  const { POST: profile } = await import('../../src/app/api/auth/profile/route');
  const { POST: teams, GET: teamList } = await import('../../src/app/api/teams/route');
  const credentials = { username: 'squad_' + randomUUID().slice(0, 8), password: randomUUID() };
  await getDb().prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), credentials.username, hashPassword(credentials.password), new Date().toISOString());
  const { cookie } = await request(login, credentials, '', '192.0.2.10');
  assert.ok(cookie);
  const header = cookie.name + '=' + cookie.value;
  for (const handler of [profile, teams]) {
    assert.equal((await request(handler, [], header)).response.status, 400);
  }
  assert.equal((await request(profile, { role: 'BLUE_TEAM', experienceLevel: 'BEGINNER' }, header)).response.status, 200);
  const created = await request(teams, { action: 'CREATE', side: 'BLUE' }, header);
  assert.equal(created.response.status, 200);
  const { teamId } = await created.response.json();
  assert.equal((await request(teams, { action: 'JOIN', teamId }, header)).response.status, 200);
  const { myTeam } = await (await request(teamList, undefined, header)).response.json();
  assert.equal(myTeam.id, teamId);
  assert.equal(myTeam.roster.length, 1);
});
