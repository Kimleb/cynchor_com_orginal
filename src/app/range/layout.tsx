import type { ReactNode } from 'react';
import { requireUser } from '@/lib/guards';
import { ensureReaperRunning } from '@/lib/range-runtime/reaper';
export default async function Layout({ children }: { children: ReactNode }) {
  await requireUser({ profile: true });
  ensureReaperRunning();
  return <>{children}</>;
}
