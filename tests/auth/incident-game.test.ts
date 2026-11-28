import './request';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../src/lib/db';
import { RULES_VERSION } from '../../src/lib/demo-team';
import { incidentGame } from '../../src/lib/incident-game';
import { getUserLevelProgress } from '../../src/lib/range-progress';

test('two ready teams share a round, score once, unlock levels and finish expired rounds', async () => {
  const db = getDb();
  const ids:string[] = [];
  const now = new Date().toISOString();
  for (const side of ['RED','BLUE']) {
    const team = randomUUID();
    await db.prepare('INSERT INTO teams (id,name,side,leader_id,created_at) VALUES (?,?,?,?,?)').run(team,side,side,team,now);
    for (let i=0;i<3;i++) {
      const id = randomUUID();
      ids.push(id);
      await db.prepare('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)').run(id,id,'test',now);
      await db.prepare('INSERT INTO team_members (id,team_id,user_id,joined_at) VALUES (?,?,?,?)').run(id,team,id,now);
      await db.prepare('INSERT INTO disclaimers (id,user_identifier,accepted_at,version) VALUES (?,?,?,?)').run(RULES_VERSION+id,id,now,RULES_VERSION);
    }
  }
  const search = await incidentGame(ids[0],'queue');
  assert.equal(search.phase,'waiting');
  assert.equal(search.deadline, undefined);
  const searchStart = async () => (await db.prepare("SELECT joined_at FROM matchmaking_queue WHERE team_id=(SELECT team_id FROM team_members WHERE user_id=?)").get(ids[0]))?.joined_at;
  const started = await searchStart();
  assert.equal((await incidentGame(ids[1],'queue')).phase, 'waiting');
  assert.equal(await searchStart(), started);
  await db.prepare("UPDATE matchmaking_queue SET joined_at=? WHERE status='INCIDENT_SEARCH'").run(new Date(Date.now()-120001).toISOString());
  assert.equal((await incidentGame(ids[3],'queue')).phase,'waiting');
  assert.equal((await incidentGame(ids[1],'status')).phase,'expired');
  assert.equal((await incidentGame(ids[3],'cancel')).phase,'idle');
  assert.equal((await incidentGame(ids[0],'queue')).phase,'waiting');
  const match = await incidentGame(ids[3],'queue');
  assert.equal(match.phase,'playing');
  for (const id of ids) await incidentGame(id,'answer',match.id,1);
  const result = await incidentGame(ids[0],'answer',match.id,0);
  assert.equal(result.red,300);
  assert.equal(result.blue,300);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM range_scores WHERE session_id=?').get(match.id!))?.n,6);
  assert.equal((await getUserLevelProgress(ids[0]))[1].unlocked,true);
  await incidentGame(ids[3],'queue');
  const next = await incidentGame(ids[0],'queue');
  assert.equal(next.level,2);
  await db.prepare('UPDATE match_sessions SET expires_at=? WHERE id=?').run(now,next.id!);
  assert.equal((await incidentGame(ids[0],'answer',next.id,0)).red,0);
});
