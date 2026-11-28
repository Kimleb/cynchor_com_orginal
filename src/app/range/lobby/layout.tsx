import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/guards';
import { getDb } from '@/lib/db';
import { TEAM_SIZE } from '@/lib/demo-team';

export default async function RangeLobbyLayout({ children }: { children: ReactNode }) {
  const user = await requireUser({ profile: true });
  const team = await getDb().prepare(`
    SELECT mine.team_id FROM team_members mine
    JOIN team_members roster ON roster.team_id = mine.team_id
    WHERE mine.user_id = ?
    GROUP BY mine.team_id HAVING COUNT(roster.id) = ?
    LIMIT 1
  `).get(user.id, TEAM_SIZE);
  if (!team) redirect('/demo/team');
  return children;
}
