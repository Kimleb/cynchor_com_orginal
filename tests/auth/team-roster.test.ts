import { request } from './request';
import { getCurrentUser } from '../../src/lib/session';
import { membership, teamReady } from '../../src/lib/team-rules';
import { RULES_VERSION } from '../../src/lib/demo-team';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { getDb, hashPassword } from '../../src/lib/db';
import { demoTeamPath, TEAM_SIZE } from '../../src/lib/demo-team';
import { POST as login } from '../../src/app/api/auth/login/route';
import { GET as roster, POST as update } from '../../src/app/api/teams/route';
import { POST as launch } from '../../src/app/api/lab/route';

async function player(index: number) {
  const id = randomUUID();
  const username = 'squad_' + id.slice(0, 8);
  const password = randomUUID();
  await getDb().prepare(`
    INSERT INTO users (id, username, password_hash, role, is_profile_completed, created_at)
    VALUES (?, ?, ?, 'BLUE_TEAM', 1, ?)
  `).run(id, username, hashPassword(password), new Date().toISOString());
  const { cookie } = await request(login, { username, password }, '', '192.0.2.' + (100 + index));
  assert.ok(cookie);
  return cookie.name + '=' + cookie.value;
}

test('an invite and teammate search fill a roster without overbooking the final slot', async () => {
  const [leader, member, applicantA, applicantB] = await Promise.all([1, 2, 3, 4].map(player));
  const created = await request(update, { action: 'AUTO_MATCH', side: 'RED' }, leader);
  assert.equal(created.response.status, 200);
  const { teamId } = await created.response.json();
  assert.equal(demoTeamPath(teamId), '/demo/team?invite=' + teamId);
  assert.equal(demoTeamPath('//another-site.invalid'), '/demo/team');
  assert.equal((await request(update, { action: 'AUTO_MATCH', side: 'RED' }, member)).response.status, 200);

  const replies = await Promise.all([applicantA, applicantB].map(cookie =>
    request(update, { action: 'JOIN', teamId }, cookie)
  ));
  assert.deepEqual(replies.map(result => result.response.status).sort(), [200, 409]);
  const { myTeam, availableTeams } = await (await request(roster, undefined, leader)).response.json();
  assert.equal(myTeam.roster.length, TEAM_SIZE);
  assert.equal(myTeam.is_complete, 1);
  assert.equal(availableTeams.some((team: { id: string }) => team.id === teamId), false);

  assert.equal(await teamReady(teamId), false);
  const winner = replies[0].response.status === 200 ? applicantA : applicantB;
  for (const cookie of [leader, member, winner]) {
    const ids = await (await request(roster, undefined, cookie)).response.json();
    const identity = await request(async () => Response.json((await getCurrentUser())?.id), undefined, cookie);
    const mine = await membership(await identity.response.json());
    assert.ok(mine);
    const other = ids.myTeam.roster.find((row: { member_id: string }) => row.member_id !== mine.id);
    const accept = (memberId: string) => request(update, { action: 'ACCEPT_RULES', memberId, version: RULES_VERSION }, cookie);
    assert.equal((await accept(other.member_id)).response.status, 409);
    assert.equal((await accept(mine.id)).response.status, 200);
    assert.equal((await accept(mine.id)).response.status, 200);
  }
  assert.equal(await teamReady(teamId), true);
  assert.equal((await request(update, { action: 'LEAVE' }, leader)).response.status, 200);
  const { myTeam: reopened } = await (await request(roster, undefined, member)).response.json();
  assert.equal(reopened.roster.length, TEAM_SIZE - 1);
  assert.equal(reopened.is_complete, 0);
  const unsuccessful = replies[0].response.status === 409 ? applicantA : applicantB;
  assert.equal((await request(update, { action: 'JOIN', teamId }, unsuccessful)).response.status, 200);
  assert.equal(await teamReady(teamId), false);
  assert.equal((await request(launch, { mode: 'SOLO' }, member)).response.status, 400);
});
