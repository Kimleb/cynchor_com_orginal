import { membership } from '@/lib/team-rules';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { demoTeamPath } from '@/lib/demo-team';
import TeamRoster from './TeamRoster';

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const query = demoTeamPath(invite).split('?')[1];
  const user = await getCurrentUser();
  if (!user) redirect(query ? '/demo/login?' + query : '/demo/login');
  if (!user.is_profile_completed) redirect(query ? '/demo/profile?' + query : '/demo/profile');

  if (await membership(user.id)) redirect('/demo/fintech');
  return <TeamRoster invite={query ? invite : undefined} />;
}
