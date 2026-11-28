import { requireRangeTeam } from '@/lib/team-rules';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/guards';
import { ensureReaperRunning } from '@/lib/range-runtime/reaper';
export default async function Layout({ children }: { children: ReactNode }) {
  const user = await requireUser({ profile: true });
  await requireRangeTeam(user.id);
  ensureReaperRunning();
  return <>{children}</>;
}
