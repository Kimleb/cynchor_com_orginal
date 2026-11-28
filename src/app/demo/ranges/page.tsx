import { requireRangeTeam } from '@/lib/team-rules';
import Link from 'next/link';
import { incidentLevels } from '@/lib/incident-game';
import React from 'react';
import { requireUser } from '@/lib/guards';
import { RANGE_LEVELS, getPlayerHandle } from '@/lib/range-levels';
import { getUserLevelProgress, getLevelLeaderboard } from '@/lib/range-progress';
import { RangesClient } from './RangesClient';

export const dynamic = 'force-dynamic';

export default async function RangesPage() {
  const user = await requireUser({ profile: true });
  await requireRangeTeam(user.id);
  const handle = getPlayerHandle(user);
  const progress = await getUserLevelProgress(handle);

  const leaderboards: Record<number, Awaited<ReturnType<typeof getLevelLeaderboard>>> = {};
  for (const lvl of RANGE_LEVELS) {
    leaderboards[lvl.id] = (await getLevelLeaderboard(lvl.id, 5));
  }

  if (process.env.VERCEL === '1' || process.env.CYNCHOR_DATABASE === 'postgres') {
    return <main className="mx-auto max-w-4xl space-y-6 px-5 py-12">
      <Link className="text-teal" href="/demo/incident">← Incident lobby</Link>
      <h1 className="font-heading text-3xl font-bold">Fintech response progress</h1>
      <p>Rounds use the highest level unlocked by everyone in both teams. Contain every affected record and keep normal records active to unlock your next level.</p>
      <div className="grid gap-4 sm:grid-cols-2">{incidentLevels.map(level => {
        const result = progress.find(row => row.levelId === level.id);
        return <section key={level.id} className="space-y-3 rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Level {level.id} · {result?.completed ? 'Completed' : result?.unlocked ? 'Unlocked' : 'Locked'}</p>
          <h2 className="font-heading text-xl">{level.title}</h2>
          <p>Personal best · {result?.bestScore ?? 0} pts</p>
          <h3 className="font-semibold">Leaderboard</h3>
          {leaderboards[level.id].length ? <ol className="list-decimal pl-5">{leaderboards[level.id].map(entry =>
            <li key={entry.username + entry.side}>@{entry.username} · {entry.side} · {entry.best_score} pts</li>)}</ol> : <p className="text-muted">No scores yet.</p>}
        </section>;
      })}</div>
    </main>;
  }

  return (
    <RangesClient
      handle={handle}
      levels={RANGE_LEVELS}
      progress={progress}
      leaderboards={leaderboards}
    />
  );
}
