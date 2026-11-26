'use client';
import React from 'react';
import Link from 'next/link';
import { useRangeEvents } from './useRangeEvents';
import { RangeFeed } from './RangeFeed';
import { VaultMeter } from './VaultMeter';
import { AttackConsole } from './AttackConsole';
import { PatchConsole } from './PatchConsole';

// Side is resolved on the server from team membership and passed in; the client never chooses it.
export function MatchView({ matchId, side, sources }: { matchId: string; side: 'RED' | 'BLUE'; sources: Record<string, string> }) {
  const { events, vault, ended, connected } = useRangeEvents(matchId);
  return (
    <div className="min-h-[80vh] bg-bg text-text py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-heading font-bold text-xl">Live match <span className={side === 'RED' ? 'text-coral' : 'text-[#38BDF8]'} data-testid="side">{side}</span></h1>
          <span className="text-[10px] font-mono text-muted">{ended ? 'MATCH ENDED' : connected ? 'STREAM CONNECTED' : 'CONNECTING...'}</span>
        </div>
        {ended && (
          <div className="p-4 rounded-xl border border-teal bg-teal/10 text-xs">
            The match is over. <Link href={`/range/match/${matchId}/report`} className="text-teal underline">View the After Action Report</Link>
          </div>
        )}
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {side === 'RED' ? <AttackConsole matchId={matchId} disabled={ended} /> : <PatchConsole matchId={matchId} initial={sources} disabled={ended} />}
          </div>
          <div className="space-y-4">
            <VaultMeter vault={vault} />
            <RangeFeed events={events} title={side === 'RED' ? 'RED TEAM FEED' : 'BLUE TEAM FEED / LOG TAIL'} />
          </div>
        </div>
      </div>
    </div>
  );
}
