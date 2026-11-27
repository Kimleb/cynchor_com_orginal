'use client';
import React, { useEffect, useState } from 'react';
import type { Leaderboard } from '@/lib/range-runtime/reports';

export default function LeaderboardPage() {
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState('');
  const [matchId, setMatchId] = useState('');
  const [exploit, setExploit] = useState('');
  useEffect(() => {
    const qs = new URLSearchParams();
    if (matchId) qs.set('matchId', matchId);
    if (exploit) qs.set('exploit', exploit);
    const q = qs.toString();
    fetch(`/api/range/leaderboard${q ? `?${q}` : ''}`)
      .then((r) => r.json())
      .then((d) => (d.success ? (setError(''), setData(d)) : setError(d.error || 'Unavailable.')))
      .catch(() => setError('Network error.'));
  }, [matchId, exploit]);
  if (error) return <div className="min-h-[60vh] flex items-center justify-center text-xs text-muted">{error}</div>;
  if (!data) return <div className="min-h-[60vh] flex items-center justify-center text-xs text-muted">Loading...</div>;
  return (
    <div className="min-h-[70vh] bg-bg text-text py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="font-heading font-bold text-2xl">Range leaderboard <span className="text-xs text-muted font-mono">{data.matchesPlayed} matches</span></h1>
        <div className="flex flex-wrap gap-3 text-xs font-mono">
          <label className="flex items-center gap-2">Room
            <select data-testid="room-filter" value={matchId} onChange={(e) => setMatchId(e.target.value)} className="bg-surface border border-border rounded px-2 py-1">
              <option value="">All rooms</option>
              {data.filters.matches.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">Level
            <select data-testid="level-filter" value={exploit} onChange={(e) => setExploit(e.target.value)} className="bg-surface border border-border rounded px-2 py-1">
              <option value="">All levels</option>
              {data.filters.exploits.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5" data-testid="team-board">
          <div className="text-xs text-muted uppercase tracking-wider mb-3">Teams</div>
          {data.teams.length === 0 ? <p className="text-xs text-muted">No finished matches yet.</p> : (
            <table className="w-full text-xs font-mono"><thead><tr className="text-muted text-left"><th>Team</th><th>Side</th><th>Played</th><th>Wins</th></tr></thead>
              <tbody>{data.teams.map((t) => <tr key={`${t.side}-${t.team}`}><td>{t.team}</td><td>{t.side}</td><td>{t.played}</td><td>{t.wins}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="bg-surface border border-border rounded-2xl p-5" data-testid="player-board">
          <div className="text-xs text-muted uppercase tracking-wider mb-3">Players</div>
          {data.players.length === 0 ? <p className="text-xs text-muted">No scored actions yet.</p> : (
            <table className="w-full text-xs font-mono"><thead><tr className="text-muted text-left"><th>Player</th><th>Exploits</th><th>Patches</th></tr></thead>
              <tbody>{data.players.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.exploits}</td><td>{p.patches}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}
