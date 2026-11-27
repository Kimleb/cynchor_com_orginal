import { NextRequest, NextResponse } from 'next/server';
import { readJsonObject } from '@/lib/request-json';
import { getCurrentUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export async function GET(req: NextRequest) {
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
        SELECT u.id, u.username, u.role, u.experience_level
        FROM team_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = ?
      `);
      roster = (await rosterStmt.all(myTeam.id)) as typeof roster;
    }

    // List available teams recruiting
    const availableTeamsStmt = db.prepare(`
      SELECT t.*, COUNT(tm.id) as member_count
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      WHERE t.status = 'RECRUITING'
      GROUP BY t.id
    `);
    const availableTeams = await availableTeamsStmt.all();

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

    // Validate that Network Security does not form combat teams in v1.1
    if (user.role === 'NET_SEC') {
      return NextResponse.json(
        { success: false, error: 'Network Security users are restricted to Learn Alone in v1.1.' },
        { status: 403 }
      );
    }

    const body = await readJsonObject(req);
    if (!body) {
      return NextResponse.json({ success: false, error: 'Expected a JSON object.' }, { status: 400 });
    }
    const { action, teamName, side, teamId } = body;
    const db = getDb();
    const now = new Date().toISOString();
    if (typeof action !== 'string' || !['CREATE', 'JOIN', 'AUTO_MATCH'].includes(action)) {
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    }
    const currentTeam = (await db.prepare('SELECT t.status AS status FROM teams t JOIN team_members tm ON tm.team_id = t.id WHERE tm.user_id = ? LIMIT 1').get(user.id)) as { status: string } | undefined;
    if (currentTeam && currentTeam.status === 'MATCHED') {
      return NextResponse.json({ success: false, error: 'You are in an active match.' }, { status: 409 });
    }
    if (action === 'JOIN') {
      if (typeof teamId !== 'string' || !teamId) {
        return NextResponse.json({ success: false, error: 'Missing team ID' }, { status: 400 });
      }
      const target = (await db.prepare('SELECT status FROM teams WHERE id = ?').get(teamId)) as { status: string } | undefined;
      const recruiting = target ? target.status === 'RECRUITING' : false;
      if (recruiting === false) {
        return NextResponse.json({ success: false, error: 'Team not found or not recruiting.' }, { status: 404 });
      }
      const membership = await db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, user.id);
      if (membership) return NextResponse.json({ success: true, teamId });

      const others = ((await db.prepare('SELECT COUNT(*) AS c FROM team_members WHERE team_id = ? AND user_id <> ?').get(teamId, user.id)) as { c: number }).c;
      if (others >= 6) {
        return NextResponse.json({ success: false, error: 'Team is full.' }, { status: 409 });
      }
    }

    // Clean up any existing team membership for this user before new join/create
    await db.prepare('DELETE FROM team_members WHERE user_id = ?').run(user.id);
    await db.prepare('DELETE FROM matchmaking_queue WHERE team_id NOT IN (SELECT DISTINCT team_id FROM team_members)').run();
    await db.prepare("DELETE FROM teams WHERE id NOT IN (SELECT DISTINCT team_id FROM team_members) AND status <> 'MATCHED'").run();
    await db.prepare('UPDATE teams SET is_complete = CASE WHEN (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = teams.id) >= 3 THEN 1 ELSE 0 END').run();
    await db.prepare('DELETE FROM matchmaking_queue WHERE team_id IN (SELECT id FROM teams WHERE is_complete = 0)').run();
    await db.prepare("UPDATE teams SET status = 'RECRUITING' WHERE is_complete = 0 AND status = 'QUEUED'").run();

    if (action === 'CREATE') {
      const newTeamId = `team_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const chosenSide = side === 'BLUE' ? 'BLUE' : 'RED';
      const name = (typeof teamName === 'string' ? teamName : '').trim().slice(0, 40) || `${user.username}'s Squad`;

      await db.prepare(`
        INSERT INTO teams (id, name, side, leader_id, is_complete, status, created_at)
        VALUES (?, ?, ?, ?, 0, 'RECRUITING', ?)
      `).run(newTeamId, name, chosenSide, user.id, now);

      await db.prepare(`
        INSERT INTO team_members (id, team_id, user_id, joined_at)
        VALUES (?, ?, ?, ?)
      `).run(`tm_${crypto.randomUUID()}`, newTeamId, user.id, now);

      return NextResponse.json({ success: true, teamId: newTeamId });
    }

    if (action === 'JOIN' && typeof teamId === 'string') {
      await db.prepare(`
        INSERT INTO team_members (id, team_id, user_id, joined_at)
        VALUES (?, ?, ?, ?)
      `).run(`tm_${crypto.randomUUID()}`, teamId, user.id, now);

      // Check member count
      const countStmt = db.prepare('SELECT COUNT(*) as count FROM team_members WHERE team_id = ?');
      const { count } = (await countStmt.get(teamId)) as { count: number };
      const isComplete = count >= 3 ? 1 : 0;

      await db.prepare('UPDATE teams SET is_complete = ? WHERE id = ?').run(isComplete, teamId);

      return NextResponse.json({ success: true, teamId });
    }

    if (action === 'AUTO_MATCH') {
      // "Match me with others": individual queue groups queued users into Red/Blue teams of 3+
      const targetSide = side === 'BLUE' ? 'BLUE' : 'RED';
      
      // Look for an existing recruiting team of that side with < 3 members
      const findTeam = db.prepare(`
        SELECT t.id, COUNT(tm.id) as count
        FROM teams t
        LEFT JOIN team_members tm ON tm.team_id = t.id
        WHERE t.side = ? AND t.status = 'RECRUITING'
        GROUP BY t.id
        HAVING COUNT(tm.id) < 3
        ORDER BY count DESC LIMIT 1
      `);
      const existing = (await findTeam.get(targetSide)) as { id: string; count: number } | undefined;

      let targetTeamId = existing?.id;

      if (!targetTeamId) {
        // Create new squad
        targetTeamId = `team_${crypto.randomUUID()}`;
        await db.prepare(`
          INSERT INTO teams (id, name, side, leader_id, is_complete, status, created_at)
          VALUES (?, ?, ?, ?, 0, 'RECRUITING', ?)
        `).run(targetTeamId, `${targetSide === 'RED' ? 'Crimson' : 'Azure'} Syndicate`, targetSide, user.id, now);
      }

      // Add user to this squad
      await db.prepare(`
        INSERT INTO team_members (id, team_id, user_id, joined_at)
        VALUES (?, ?, ?, ?)
      `).run(`tm_${crypto.randomUUID()}`, targetTeamId, user.id, now);

      // Re-verify completion
      const finalCount = ((await db.prepare('SELECT COUNT(*) as count FROM team_members WHERE team_id = ?').get(targetTeamId)) as { count: number }).count;
      const isComplete = finalCount >= 3 ? 1 : 0;
      await db.prepare('UPDATE teams SET is_complete = ? WHERE id = ?').run(isComplete, targetTeamId);

      return NextResponse.json({ success: true, teamId: targetTeamId, isComplete: Boolean(isComplete) });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    console.error(err); const message = 'Internal error.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

