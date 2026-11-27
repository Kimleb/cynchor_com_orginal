'use client';
import React, { useRef, useEffect } from 'react';
import { Terminal } from 'lucide-react';
import { stripTag, type RangeEvent } from './useRangeEvents';

function tone(action: string): string {
  if (action === 'RANGE_EXPLOIT_LANDED' || action === 'RANGE_PROXY_REQUEST') return 'border-coral text-coral bg-coral/10';
  if (action === 'RANGE_EXPLOIT_BLOCKED' || action === 'RANGE_PATCH_APPLIED') return 'border-[#38BDF8] text-[#38BDF8] bg-[#38BDF8]/10';
  return 'border-[#26262C] text-[#A1A1AA]';
}

// Auto-scrolling, timestamped, colour-coded feed in the style of visuals/LogStream.
export function RangeFeed({ events, title = 'LIVE RANGE FEED', className = '' }: { events: RangeEvent[]; title?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
  }, [events]);
  return (
    <div className={`bg-[#0A0A0D] rounded-xl border border-border p-3.5 flex flex-col font-mono ${className}`}>
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#26262C] text-xs">
        <div className="flex items-center gap-2 text-muted">
          <Terminal className="w-3.5 h-3.5 text-teal" />
          <span className="font-semibold text-text uppercase tracking-wider">{title}</span>
        </div>
        <span className="text-[10px] text-teal animate-pulse">● LIVE</span>
      </div>
      <div ref={ref} data-testid="range-feed" className="space-y-1.5 overflow-y-auto max-h-80 text-[11px] leading-relaxed">
        {events.length === 0 ? (
          <div className="text-muted/60 py-4 text-center">Waiting for events...</div>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className={`p-1 pl-2 rounded border-l-2 ${tone(ev.action)}`}>
              <span className="text-muted/70 mr-2 text-[10px]">{new Date(ev.at).toLocaleTimeString()}</span>
              <span className="mr-2 font-semibold">[{ev.action.replace('RANGE_', '')}]</span>
              {ev.user !== null && <span className="mr-2 text-text">{ev.user}</span>}
              <span className="break-all">{stripTag(ev.details)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
