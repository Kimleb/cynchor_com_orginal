import { readFileSync } from 'fs';
import path from 'path';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { getMatchAccess } from '@/lib/range-runtime/lobby';
import { MatchView } from '@/components/range/MatchView';

export const dynamic = 'force-dynamic';

// The viewer's side comes from team membership in the database, resolved here before anything renders.
export default async function RangeMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const user = await getCurrentUser();
  if (user === null) redirect('/demo/login');
  const access = getMatchAccess(user.id, matchId);
  if (access === null) redirect('/range/lobby');
  if (!access.matchActive) redirect(`/range/match/${matchId}/report`);
  const sources: Record<string, string> = {};
  if (access.side === 'BLUE') {
    for (const f of ['server.js', 'db.js']) sources[f] = readFileSync(path.join(process.cwd(), 'range-target', f), 'utf8');
  }
  return <MatchView matchId={matchId} side={access.side} sources={sources} />;
}
