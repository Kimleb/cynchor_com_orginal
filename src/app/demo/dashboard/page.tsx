import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/guards';
import { membership } from '@/lib/team-rules';
import TeamRoster from '../team/TeamRoster';

export default async function DashboardPage() {
  const user = await requireUser({ profile: true });
  if (await membership(user.id)) redirect('/demo/fintech');
  return <TeamRoster />;
}
