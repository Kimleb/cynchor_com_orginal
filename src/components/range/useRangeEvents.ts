'use client';
import { useEffect, useState } from 'react';

export interface RangeEvent {
  id: number;
  action: string;
  user: string | null;
  details: string;
  at: string;
}
export interface VaultState {
  balanceCents: number | null;
  status: string | null;
}

// Strips the "[range:<id>:<SCOPE>] " tag the server puts in front of every range audit row.
export function stripTag(details: string): string {
  return details.replace(/^\[range:[^\]]*\]\s*/, '');
}

// Consumes /api/range/<matchId>/events. All state comes from server-sent events, nothing is simulated client-side.
export function useRangeEvents(matchId: string, role?: 'spectator') {
  const [events, setEvents] = useState<RangeEvent[]>([]);
  const [vault, setVault] = useState<VaultState>({ balanceCents: null, status: null });
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const url = `/api/range/${encodeURIComponent(matchId)}/events${role === 'spectator' ? '?role=spectator' : ''}`;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('vault', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { balance_cents: number | null; status: string };
      setVault({ balanceCents: d.balance_cents, status: d.status });
    });
    es.addEventListener('audit', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as RangeEvent;
      setEvents((prev) => (prev.some((p) => p.id === d.id) ? prev : [...prev, d].slice(-500)));
    });
    es.addEventListener('end', () => {
      setEnded(true);
      es.close();
    });
    return () => es.close();
  }, [matchId, role]);

  return { events, vault, ended, connected };
}
