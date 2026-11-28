import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/guards';
import { membership } from '@/lib/team-rules';
import SquadChat from '../team/SquadChat';
import TeamRoster from '../team/TeamRoster';

export default async function FintechPage() {
  const user = await requireUser({ profile: true });
  const member = await membership(user.id);
  if (!member) redirect('/demo/dashboard');
  const lobby = process.env.VERCEL !== '1' && process.env.CYNCHOR_DATABASE !== 'postgres' ? '/range/lobby' : '/demo/incident';
  return <><TeamRoster memberId={member.id} lobby={lobby} /><div className="mx-auto max-w-4xl px-5 pb-12"><SquadChat /></div></>;
}
