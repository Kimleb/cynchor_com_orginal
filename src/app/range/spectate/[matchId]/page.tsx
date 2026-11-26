import { notFound } from 'next/navigation';
import { rangeMatchExists } from '@/lib/range-runtime/lobby';
import { SpectatorView } from '@/components/range/SpectatorView';

export const dynamic = 'force-dynamic';

// Read-only. Login is enforced by src/app/range/layout.tsx; no team membership is required.
export default function RangeSpectatePage({ params }: { params: { matchId: string } }) {
  if (!rangeMatchExists(params.matchId)) notFound();
  return <SpectatorView matchId={params.matchId} />;
}
