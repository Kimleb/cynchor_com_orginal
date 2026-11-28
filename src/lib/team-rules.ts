import { getDb } from '@/lib/db';
import { redirect } from 'next/navigation';
import { TEAM_SIZE, RULES_VERSION } from '@/lib/demo-team';

export async function membership(userId: string) {
  return getDb().prepare(`
    SELECT tm.id, tm.team_id, d.accepted_at FROM team_members tm
    LEFT JOIN disclaimers d ON d.id = ? || tm.id AND d.version = ?
    WHERE tm.user_id = ? ORDER BY tm.joined_at DESC LIMIT 1
  `).get(RULES_VERSION, RULES_VERSION, userId);
}

export async function teamReady(teamId: string) {
  const row = await getDb().prepare(`
    SELECT COUNT(tm.id) AS size, COUNT(d.id) AS accepted FROM team_members tm
    LEFT JOIN disclaimers d ON d.id = ? || tm.id AND d.version = ?
    WHERE tm.team_id = ?
  `).get(RULES_VERSION, RULES_VERSION, teamId);
  return Number(row?.size) === TEAM_SIZE && Number(row?.accepted) === TEAM_SIZE;
}

export async function requireRangeTeam(userId: string) {
  const member = await membership(userId);
  if (!member) redirect('/demo/dashboard');
  if (!member.accepted_at || !await teamReady(member.team_id)) redirect('/demo/fintech');
}

export async function hasRangeAccess(userId: string) {
  const member = await membership(userId);
  return Boolean(member?.accepted_at && await teamReady(member.team_id));
}
