import { requireRangeTeam } from '@/lib/team-rules';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/guards';

export default async function Layout({ children }: { children: ReactNode }) {
  const user = await requireUser({ profile: true });
  await requireRangeTeam(user.id);
  return <>{children}</>;
}
