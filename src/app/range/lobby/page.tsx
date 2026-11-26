'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Crosshair, Shield, Users } from 'lucide-react';

interface MyTeam { id: string; name: string; side: 'RED' | 'BLUE'; status: string; size: number }
interface QueuedTeam { name: string; side: 'RED' | 'BLUE'; joinedAt: string; size: number }

export default function RangeLobbyPage() {
  const router = useRouter();
  const [myTeam, setMyTeam] = useState<MyTeam | null>(null);
  const [queued, setQueued] = useState<QueuedTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/range/queue');
      const data = await res.json();
      if (data.success) {
        setMyTeam(data.myTeam);
        setQueued(data.queued);
        if (data.activeSessionId) router.push(`/range/match/${data.activeSessionId}`);
      }
    } catch {
      // keep polling
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const join = async () => {
    if (!myTeam) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/range/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId: myTeam.id }) });
      const data = await res.json();
      if (!data.success) setError(data.error || 'Could not join the queue.');
      else if (data.matched) router.push(`/range/match/${data.sessionId}`);
      else setMessage(data.message || 'Queued.');
      await refresh();
    } catch {
      setError('Network error.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center text-xs text-muted">Loading lobby...</div>;

  if (!myTeam) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6 text-text">
        <div className="p-8 bg-surface border border-border rounded-2xl max-w-md text-center space-y-4">
          <h2 className="font-heading font-bold text-lg">No squad yet</h2>
          <p className="text-xs text-muted">You need a squad to queue for the range.</p>
          <Link href="/demo/team" className="py-2.5 px-4 rounded-xl bg-teal text-bg text-xs font-heading font-semibold inline-block">Go to Team Formation</Link>
        </div>
      </div>
    );
  }

  const isQueued = myTeam.status === 'QUEUED';
  const SideIcon = myTeam.side === 'RED' ? Crosshair : Shield;
  return (
    <div className="min-h-[70vh] bg-bg text-text py-12 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <SideIcon className={`w-6 h-6 ${myTeam.side === 'RED' ? 'text-coral' : 'text-[#38BDF8]'}`} />
            <div>
              <h1 className="font-heading font-bold text-xl">{myTeam.name}</h1>
              <p className="text-xs text-muted">{myTeam.side} team · {myTeam.size} member{myTeam.size === 1 ? '' : 's'} · {myTeam.status}</p>
            </div>
          </div>
          {error && <div className="text-xs text-coral" role="alert">{error}</div>}
          {message && !error && <div className="text-xs text-teal">{message}</div>}
          <button
            onClick={join}
            disabled={busy || isQueued || myTeam.status === 'MATCHED'}
            className="py-2.5 px-4 rounded-xl bg-teal text-bg text-xs font-heading font-semibold disabled:opacity-50"
          >
            {isQueued ? 'Searching for an opposing squad...' : busy ? 'Joining...' : `Queue as ${myTeam.side}`}
          </button>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6">
          <div className="flex items-center gap-2 text-xs text-muted uppercase tracking-wider mb-3"><Users className="w-4 h-4" /> Squads in queue</div>
          {queued.length === 0 ? (
            <p className="text-xs text-muted">Nobody is queued right now.</p>
          ) : (
            <ul className="space-y-2" data-testid="queue-list">
              {queued.map((q) => (
                <li key={`${q.side}-${q.name}`} className="flex justify-between text-xs font-mono">
                  <span>{q.name}</span>
                  <span className={q.side === 'RED' ? 'text-coral' : 'text-[#38BDF8]'}>{q.side} · {q.size}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
