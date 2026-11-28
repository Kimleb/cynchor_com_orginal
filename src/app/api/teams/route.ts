import { NextRequest, NextResponse } from 'next/server';
import { readJsonObject } from '@/lib/request-json';
import { getCurrentUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { membership } from '@/lib/team-rules';
import crypto from 'crypto';
import { RULES_VERSION, TEAM_SIZE } from '@/lib/demo-team';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const db = getDb();

    // Fetch user's current team if any
    const myTeamStmt = db.prepare(`
      SELECT t.* FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE tm.user_id = ?
      LIMIT 1
    `);
    const myTeam = (await myTeamStmt.get(user.id)) as {
      id: string;
      name: string;
      side: 'RED' | 'BLUE';
      leader_id: string;
      is_complete: number;
      status: string;
    } | undefined;

    let roster: Array<{ id: string; username: string; role: string; experience_level: string }> = [];
    if (myTeam) {
      const rosterStmt = db.prepare(`
        SELECT u.id, tm.id AS member_id, u.username, u.role, u.experience_level, d.accepted_at
        FROM team_members tm
        JOIN users u ON u.id = tm.user_id
        LEFT JOIN disclaimers d ON d.id = ? || tm.id AND d.version = ?
        WHERE tm.team_id = ?
      `);
      roster = (await rosterStmt.all(RULES_VERSION, RULES_VERSION, myTeam.id)) as typeof roster;
    }

    // List available teams recruiting
    const availableTeamsStmt = db.prepare(`
      SELECT t.*, COUNT(tm.id) as member_count
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      WHERE t.status = 'RECRUITING'
      GROUP BY t.id
      HAVING COUNT(tm.id) < ?
    `);
    const availableTeams = await availableTeamsStmt.all(TEAM_SIZE);

    return NextResponse.json({
      success: true,
      myTeam: myTeam ? { ...myTeam, roster } : null,
      availableTeams,
    });
  } catch (err: unknown) {
    console.error(err); const message = 'Internal error.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await readJsonObject(req);
    const action = body?.action;
    if (action !== 'CREATE' && action !== 'JOIN' && action !== 'AUTO_MATCH' && action !== 'LEAVE' && action !== 'ACCEPT_RULES') {
      return NextResponse.json({ success: false, error: 'Unknown team action.' }, { status: 400 });
    }

    if (!user.is_profile_completed) {
      return NextResponse.json({ success: false, error: 'Complete your profile first.' }, { status: 403 });
    }

    const db = getDb();
    return await db.transaction(async () => {
      const current = await db.prepare(`
        SELECT t.id, t.status, t.leader_id FROM teams t JOIN team_members tm ON t.id = tm.team_id
        WHERE tm.user_id = ? ORDER BY tm.joined_at DESC LIMIT 1
      `).get(user.id);
      const requestedId = typeof body?.teamId === 'string' ? body.teamId.trim() : '';
      const response = (teamId: string) => NextResponse.json({ success: true, teamId });
      const conflict = (error: string) => NextResponse.json({ success: false, error }, { status: 409 });

      if (action === 'ACCEPT_RULES') {
        const member = await membership(user.id);
        if (!member || body?.memberId !== member.id || body?.version !== RULES_VERSION) {
          return conflict('Your membership or the rules changed. Refresh the team room.');
        }
        await db.prepare(`
          INSERT INTO disclaimers (id, accepted_at, user_identifier, version)
          VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING
        `).run(RULES_VERSION + member.id, new Date().toISOString(), user.id, RULES_VERSION);
        return response(member.team_id);
      }
      if (current) {
        if (action === 'AUTO_MATCH' || (action === 'JOIN' && requestedId === current.id)) return response(current.id);
        if (action !== 'LEAVE') return conflict('Leave your current team before joining another.');
        if (current.status === 'MATCHED') return conflict('Finish your active match before leaving the team.');
        await db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(current.id, user.id);
        await db.prepare('DELETE FROM matchmaking_queue WHERE team_id = ?').run(current.id);
        const next = await db.prepare('SELECT user_id FROM team_members WHERE team_id = ? ORDER BY joined_at, id LIMIT 1').get(current.id);
        if (next) {
          await db.prepare(`
            UPDATE teams SET leader_id = ?, status = 'RECRUITING',
              is_complete = CASE WHEN (SELECT COUNT(*) FROM team_members WHERE team_id = ?) = ? THEN 1 ELSE 0 END
            WHERE id = ?
          `).run(current.leader_id === user.id ? next.user_id : current.leader_id, current.id, TEAM_SIZE, current.id);
        } else {
          await db.prepare('DELETE FROM teams WHERE id = ?').run(current.id);
        }
        return NextResponse.json({ success: true });
      }
      if (action === 'LEAVE') return NextResponse.json({ success: true });

      const side = body?.side === 'BLUE' ? 'BLUE' : 'RED';
      let teamId: string | undefined;
      if (action === 'JOIN') {
        if (!requestedId) return NextResponse.json({ success: false, error: 'Enter a team ID.' }, { status: 400 });
        const target = await db.prepare('SELECT status FROM teams WHERE id = ?').get(requestedId);
        if (!target) return NextResponse.json({ success: false, error: 'Team not found.' }, { status: 404 });
        if (target.status !== 'RECRUITING') return conflict('This team is currently closed to new members.');
        teamId = requestedId;
      }
      if (action === 'AUTO_MATCH') {
        const recruiting = await db.prepare(`
          SELECT t.id FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id
          WHERE t.side = ? AND t.status = 'RECRUITING'
          GROUP BY t.id HAVING COUNT(tm.id) < ?
          ORDER BY COUNT(tm.id) DESC, t.created_at, t.id LIMIT 1
        `).get(side, TEAM_SIZE);
        teamId = recruiting?.id;
      }

      const now = new Date().toISOString();
      if (teamId) {
        const count = await db.prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id = ?').get(teamId);
        if (Number(count?.total) >= TEAM_SIZE) return conflict('This team already has three members.');
      } else {
        teamId = `team_${crypto.randomUUID()}`;
        const name = (typeof body?.teamName === 'string' ? body.teamName : '').trim().slice(0, 40)
          || `${user.username}'s Squad`;
        await db.prepare('INSERT INTO teams (id, name, side, leader_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(teamId, name, side, user.id, now);
      }
      await db.prepare('INSERT INTO team_members (id, team_id, user_id, joined_at) VALUES (?, ?, ?, ?)')
        .run(`tm_${crypto.randomUUID()}`, teamId, user.id, now);
      const count = await db.prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id = ?').get(teamId);
      await db.prepare('UPDATE teams SET is_complete = ? WHERE id = ?')
        .run(Number(count?.total) === TEAM_SIZE ? 1 : 0, teamId);
      return response(teamId);
    });
  } catch (error) {
    console.error('Team update failed', error);
    return NextResponse.json({ success: false, error: 'Could not update the team.' }, { status: 500 });
  }
}
