import { requireUser } from '@/lib/guards';
import { requireRangeTeam } from '@/lib/team-rules';
import Round from './Round';
export default async function IncidentPage() {
  const user = await requireUser({profile:true});
  await requireRangeTeam(user.id);
  return <Round />;
}
