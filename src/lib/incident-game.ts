import { transferView, transferPoints, moveTransfer, type BankPlayer } from './transfer-game';
import { drills, drillView } from './incident-drills';
import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { completeLevelForUser } from './range-progress';
import { membership, teamReady } from './team-rules';

const cases = [
  { title: 'Unrecognized sign-in', prompt: 'A cashier confirms that a successful sign-in from a new device was not theirs. Which action contains the incident?', options: ['Archive the alert', 'Revoke the affected sessions and verify the cashier’s identity', 'Wait for a second alert'], correct: 1 },
  { title: 'Account privacy', prompt: 'A customer sees another customer’s statement. What should the response team do first?', options: ['Restrict the affected feature and preserve access logs', 'Ask the customer to refresh', 'Erase the logs'], correct: 0 },
  { title: 'Duplicate settlements', prompt: 'Two settlement entries share one transaction reference. What best protects the ledger?', options: ['Delete both entries', 'Process the batch again', 'Hold the affected batch and reconcile against the source records'], correct: 2 },
  { title: 'Unexpected privilege change', prompt: 'An unapproved administrator grant appears during recovery. Which response preserves evidence and limits exposure?', options: ['Close the incident', 'Suspend the grant, preserve the audit trail and review its use', 'Rotate the dashboard theme'], correct: 1 },
];
export const incidentLevels = ['Branch clearing', 'Priority clearing', 'Rapid settlement', 'Express settlement'].map((title,index)=>({id:index+1,title}));

type Player = BankPlayer;
export type IncidentView = {
  phase: 'idle' | 'expired' | 'waiting' | 'playing' | 'finished'; id?: string; level?: number;
  bank?: ReturnType<typeof transferView>; drill?: ReturnType<typeof drillView>; title?: string; prompt?: string; options?: string[]; deadline?: string; choice?: number;
  red?: number; blue?: number; submitted?: number; answer?: string;
};
export class GameError extends Error {}
export async function incidentGame(userId: string, action: string, matchId?: unknown, choice?: unknown): Promise<IncidentView> {
  const db = getDb();
  return db.transaction(async () => {
    const member = await membership(userId);
    if (!member?.accepted_at || !await teamReady(member.team_id)) throw new GameError('All three members must accept the rules.');
    const teamId = member.team_id;
    const team = await db.prepare('SELECT side, status FROM teams WHERE id = ?').get(teamId);
    if (!team) throw new GameError('Join a team first.');
    const searchWindow = 120_000;
    const cutoff = new Date(Date.now() - searchWindow).toISOString();
    const search = await db.prepare("SELECT joined_at FROM matchmaking_queue WHERE team_id=? AND status='INCIDENT_SEARCH'").get(teamId);
    if (team.status === 'INCIDENT_WAIT' && (!search || search.joined_at <= cutoff)) {
      if (action !== 'queue' && action !== 'cancel') return { phase: 'expired' };
    }
    const current = await db.prepare(`SELECT * FROM match_sessions WHERE mode = 'INCIDENT'
      AND (red_team_id = ? OR blue_team_id = ?) ORDER BY created_at DESC, id DESC LIMIT 1`).get(teamId, teamId);
    const wasPlaying = current?.status === 'ROUND';
    if (current && (wasPlaying || (action !== 'queue' && team.status !== 'INCIDENT_WAIT'))) {
      const players: Player[] = JSON.parse(current.summary_json);
      const me = players.find(p => p.id === userId);
      if (!me && wasPlaying) throw new GameError('This round belongs to the original roster.');
      if (me) {
        const scenario = cases[current.level_id - 1];
        const bank = me.transfers !== undefined;
        const timestamp = Date.now();
        if (bank && ['dispatch','intercept'].includes(action)) {
          if (matchId !== current.id || !wasPlaying || timestamp >= Date.parse(current.expires_at)) throw new GameError('This round has closed.');
          const error = moveTransfer(players,me,action,choice,timestamp,Date.parse(current.expires_at),current.level_id);
          if (error) throw new GameError(error);
          await db.prepare('UPDATE match_sessions SET summary_json=? WHERE id=?').run(JSON.stringify(players),current.id);
        }
        if (bank && ['submit','apply','answer','restore'].includes(action)) throw new GameError('Use the live transfer desk.');
        if (['answer','apply','restore','submit'].includes(action)) {
          if (matchId !== current.id) throw new GameError('Refresh to see your current round.');
          if (wasPlaying && Date.now() < Date.parse(current.expires_at) && me.choice === undefined) {
            if (me.practical) {
              const task = drills[current.level_id-1];
              if (action === 'submit') {
                me.choice = task.targets.every(id => me.held?.includes(id)) && me.held?.length === task.targets.length ? 1 : 0;
              } else {
                if (!['apply','restore'].includes(action) || typeof choice !== 'number' || !Number.isInteger(choice) || !task.evidence[choice]) throw new GameError('Select a record in your workspace.');
                const held = new Set(me.held);
                if (action === 'apply') held.add(choice);
                else held.delete(choice);
                me.held = [...held];
              }
            } else {
              if (action !== 'answer' || typeof choice !== 'number' || !Number.isInteger(choice) || !scenario.options[choice]) throw new GameError('Choose one response.');
              me.choice = choice;
            }
            await db.prepare('UPDATE match_sessions SET summary_json = ? WHERE id = ?').run(JSON.stringify(players), current.id);
          }
        }
        const submitted = players.filter(p => p.choice !== undefined).length;
        const board = bank ? transferView(players,me,timestamp) : undefined;
        const allCleared = board?.ledger.length === 9 && board.ledger.every(t=>t.state !== 'Pending');
        const finished = allCleared || !wasPlaying || submitted === players.length || Date.now() >= Date.parse(current.expires_at);
        const points = (p: Player) => bank ? transferPoints(players,p,timestamp) : p.choice === (p.practical ? 1 : scenario.correct) ? 100 : 0;
        const total = (side: string) => players.filter(p => p.side === side).reduce((n,p) => n + points(p), 0);
        const red = total('RED'), blue = total('BLUE');
        if (finished && wasPlaying) {
          const now = new Date().toISOString();
          for (const p of players.filter(p => bank || p.choice !== undefined)) {
            await db.prepare('INSERT INTO range_scores (id,session_id,level_id,username,side,score,vault_remaining,created_at) VALUES (?,?,?,?,?,?,?,?)')
              .run(randomUUID(), current.id, current.level_id, p.handle, p.side, points(p), 0, now);
            if (points(p)) await completeLevelForUser(p.handle, current.level_id, points(p));
          }
          await db.prepare("UPDATE match_sessions SET status='ENDED', ended_at=?, red_score=?, blue_score=?, winner=? WHERE id=?")
            .run(now,red,blue,red === blue ? 'TIE' : red > blue ? 'RED' : 'BLUE',current.id);
          await db.prepare("UPDATE teams SET status='RECRUITING' WHERE id IN (?,?)").run(current.red_team_id,current.blue_team_id);
        }
        return { phase: finished ? 'finished' : 'playing', id: current.id, level: current.level_id, bank: board, drill: !bank && me.practical ? drillView(players,me,current.level_id,current.id) : undefined, ...(bank || me.practical ? {} : {title: scenario.title, prompt: scenario.prompt, options: scenario.options}), deadline: current.expires_at, choice: me.choice, submitted, ...(finished ? { red, blue, answer: bank || me.practical ? undefined : scenario.options[scenario.correct] } : {}) };
      }
    }
    if (action === 'cancel') {
      await db.prepare("UPDATE teams SET status='RECRUITING' WHERE id=? AND status='INCIDENT_WAIT'").run(teamId);
      await db.prepare("DELETE FROM matchmaking_queue WHERE team_id=? AND status='INCIDENT_SEARCH'").run(teamId);
      return { phase: 'idle' };
    }
    if (action !== 'queue') return { phase: team.status === 'INCIDENT_WAIT' ? 'waiting' : 'idle' };
    if (!['RECRUITING','INCIDENT_WAIT'].includes(team.status)) throw new GameError('Finish your current team activity first.');
    const opponent = await db.prepare("SELECT t.id FROM teams t JOIN matchmaking_queue q ON q.team_id=t.id WHERE t.status='INCIDENT_WAIT' AND q.status='INCIDENT_SEARCH' AND q.joined_at > ? AND t.side <> ? ORDER BY q.joined_at,t.id LIMIT 1").get(cutoff,team.side);
    if (!opponent || !await teamReady(opponent.id)) {
      await db.prepare("UPDATE teams SET status='INCIDENT_WAIT' WHERE id=?").run(teamId);
      const started = team.status === 'INCIDENT_WAIT' && search && search.joined_at > cutoff ? search.joined_at : new Date().toISOString();
      await db.prepare(`INSERT INTO matchmaking_queue (id,team_id,side,status,joined_at) VALUES (?,?,?,'INCIDENT_SEARCH',?)
        ON CONFLICT(team_id) DO UPDATE SET status='INCIDENT_SEARCH', joined_at=excluded.joined_at, side=excluded.side`)
        .run(randomUUID(),teamId,team.side,started);
      return { phase: 'waiting' };
    }
    const roster = await db.prepare(`SELECT u.id, LOWER(u.username) AS handle, t.side,
      COALESCE((SELECT MAX(level_id) FROM level_progress WHERE username=LOWER(u.username)),1) AS level
      FROM team_members m JOIN users u ON m.user_id=u.id JOIN teams t ON m.team_id=t.id WHERE t.id IN (?,?)`).all(teamId,opponent.id);
    const players: Player[] = roster.map(p => ({id:p.id, handle:p.handle, side:p.side, transfers:[]}));
    const level = Math.min(cases.length,...roster.map(p => Number(p.level)));
    const id = randomUUID(), now = new Date(), deadline = new Date(now.getTime()+120000).toISOString();
    const red = team.side === 'RED' ? teamId : opponent.id, blue = team.side === 'BLUE' ? teamId : opponent.id;
    await db.prepare(`INSERT INTO match_sessions (id,mode,status,red_team_id,blue_team_id,level_id,summary_json,created_at,expires_at)
      VALUES (?,'INCIDENT','ROUND',?,?,?,?,?,?)`).run(id,red,blue,level,JSON.stringify(players),now.toISOString(),deadline);
    await db.prepare("UPDATE teams SET status='MATCHED' WHERE id IN (?,?)").run(red,blue);
    await db.prepare("DELETE FROM matchmaking_queue WHERE team_id IN (?,?) AND status='INCIDENT_SEARCH'").run(red,blue);
    return { phase:'playing', id, level, deadline, bank:transferView(players,players.find(p=>p.id===userId)!,now.getTime()), submitted:0 };
  });
}
