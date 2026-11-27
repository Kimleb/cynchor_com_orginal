import React from 'react';
import { requireUser } from '@/lib/guards';
import { RANGE_LEVELS, getPlayerHandle } from '@/lib/range-levels';
import { getUserLevelProgress, getLevelLeaderboard } from '@/lib/range-progress';
import { RangesClient } from './RangesClient';

export const dynamic = 'force-dynamic';

export default async function RangesPage() {
  const user = await requireUser({ profile: true });
  const handle = getPlayerHandle(user);
  const progress = await getUserLevelProgress(handle);

  const leaderboards: Record<number, Awaited<ReturnType<typeof getLevelLeaderboard>>> = {};
  for (const lvl of RANGE_LEVELS) {
    leaderboards[lvl.id] = (await getLevelLeaderboard(lvl.id, 5));
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
