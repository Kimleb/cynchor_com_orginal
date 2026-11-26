'use client';
import React from 'react';
import Link from 'next/link';
import { useRangeEvents } from './useRangeEvents';
import { RangeFeed } from './RangeFeed';
import { VaultMeter } from './VaultMeter';

export function SpectatorView({ matchId }: { matchId: string }) {
  const { events, vault, ended, connected } = useRangeEvents(matchId, 'spectator');
  const landed = events.filter((e) => e.action === 'RANGE_EXPLOIT_LANDED').length;
  const blocked = events.filter((e) => e.action === 'RANGE_EXPLOIT_BLOCKED').length;
  return (
    <div className="min-h-[80vh] bg-bg text-text py-8 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-heading font-bold text-xl">Spectating match</h1>
          <span className="text-[10px] font-mono text-muted">{ended ? 'MATCH ENDED' : connected ? 'STREAM CONNECTED' : 'CONNECTING...'}</span>
        </div>
        {ended && (
          <div className="p-4 rounded-xl border border-teal bg-teal/10 text-xs">
            <Link href={`/range/match/${matchId}/report`} className="text-teal underline">View the After Action Report</Link>
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-4">
            <VaultMeter vault={vault} />
            <div className="bg-[#0A0A0D] rounded-xl border border-border p-4 font-mono text-xs space-y-1" data-testid="score">
              <div className="text-muted uppercase tracking-wider">Running score</div>
              <div><span className="text-coral">Red exploits landed:</span> {landed}</div>
              <div><span className="text-[#38BDF8]">Blue exploits blocked:</span> {blocked}</div>
            </div>
          </div>
          <div className="md:col-span-2"><RangeFeed events={events} title="COMBINED EVENT FEED" /></div>
        </div>
      </div>
    </div>
  );
}
