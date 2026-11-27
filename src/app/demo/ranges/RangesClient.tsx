'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/common/Badge';
import type { RangeLevelConfig } from '@/lib/range-levels';
import type { UserLevelStatus, LeaderboardEntry } from '@/lib/range-progress';
import {
  Shield,
  Crosshair,
  Lock,
  Unlock,
  Clock,
  DollarSign,
  Trophy,
  AlertTriangle,
  ArrowLeft,
  Loader2,
} from 'lucide-react';

interface RangesClientProps {
  handle: string;
  levels: RangeLevelConfig[];
  progress: UserLevelStatus[];
  leaderboards: Record<number, LeaderboardEntry[]>;
}

export function RangesClient({ handle, levels, progress, leaderboards }: RangesClientProps) {
  const router = useRouter();
  const [selectedSide, setSelectedSide] = useState<Record<number, 'RED' | 'BLUE'>>({
    1: 'RED',
    2: 'RED',
    3: 'RED',
    4: 'RED',
  });
  const [roeAccepted, setRoeAccepted] = useState(false);
  const [queuingLevel, setQueuingLevel] = useState<number | null>(null);
  const [queueStatus, setQueueStatus] = useState<string>('');
  const [error, setError] = useState('');

  // Poll / SSE while waiting in queue
  useEffect(() => {
    if (queuingLevel === null) return;
    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/matchmaking?levelId=${queuingLevel}`);
        const data = await res.json();
        if (!active) return;
        if (data.matched && data.sessionId) {
          clearInterval(interval);
          router.push(`/demo/range/${data.sessionId}`);
        } else if (data.queued) {
          setQueueStatus(`Waiting for opponent in Level ${queuingLevel} (${data.side})...`);
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [queuingLevel, router]);

  const handleJoinMatchmaking = async (levelId: number) => {
    setError('');
    if (!roeAccepted) {
      setError('You must accept the Rules of Engagement notice before entering a live match.');
      return;
    }

    const side = selectedSide[levelId] || 'RED';
    setQueuingLevel(levelId);
    setQueueStatus(`Joining Level ${levelId} queue as ${side}...`);

    try {
      const res = await fetch('/api/matchmaking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'RANGE_1V1',
          levelId,
          side,
          roeAccepted: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not join matchmaking.');
        setQueuingLevel(null);
        setQueueStatus('');
        return;
      }

      if (data.matched && data.sessionId) {
        router.push(`/demo/range/${data.sessionId}`);
      } else {
        setQueueStatus(`Queued for Level ${levelId} as ${side}. Waiting for opponent...`);
      }
    } catch {
      setError('Network error joining matchmaking.');
      setQueuingLevel(null);
      setQueueStatus('');
    }
  };

  return (
    <div className="min-h-[90vh] bg-bg text-text py-10 px-4 sm:px-6">
      <div className="container mx-auto max-w-6xl space-y-8">
        {/* Top Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface p-6 rounded-2xl border border-border shadow-md">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href="/demo/dashboard"
                className="text-xs text-muted hover:text-text inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
              </Link>
              <Badge type="v1" size="sm" />
            </div>
            <h1 className="font-heading font-bold text-2xl text-text tracking-tightest">
              Fintech Ranges — Live Red vs Blue
            </h1>
            <p className="text-xs text-muted mt-0.5">
              Operator handle: <code className="font-mono text-teal">@{handle}</code> • Real vulnerable fintech target, ephemeral per-match isolation.
            </p>
          </div>
        </div>

        {/* Rules of Engagement Notice */}
        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/40 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-heading font-semibold text-amber-300">
                Rules of Engagement (Mandatory Before First Match)
              </div>
              <p className="text-amber-200/90 leading-relaxed">
                Attacks are authorized <strong>ONLY</strong> against your assigned match target via the Cynchor reverse proxy. Do not probe the host, other matches, or external networks.
              </p>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer bg-surface px-3 py-2 rounded-xl border border-border">
            <input
              type="checkbox"
              checked={roeAccepted}
              onChange={(e) => setRoeAccepted(e.target.checked)}
              className="accent-teal"
            />
            <span className="font-heading font-semibold text-text">I accept ROE</span>
          </label>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-coral/10 border border-coral/30 text-coral text-xs">
            {error}
          </div>
        )}

        {queueStatus && (
          <div className="p-4 rounded-xl bg-teal/10 border border-teal/30 text-teal text-xs flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{queueStatus}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setQueuingLevel(null);
                setQueueStatus('');
              }}
              className="text-xs underline"
            >
              Leave Queue
            </button>
          </div>
        )}

        {/* Levels Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {levels.map((lvl) => {
            const st = progress.find((p) => p.levelId === lvl.id) || {
              levelId: lvl.id,
              unlocked: lvl.id === 1,
              completed: false,
              bestScore: 0,
            };
            const side = selectedSide[lvl.id] || 'RED';
            const lb = leaderboards[lvl.id] || [];

            return (
              <div
                key={lvl.id}
                className={`p-6 rounded-2xl border bg-surface flex flex-col justify-between space-y-5 ${
                  st.unlocked ? 'border-border' : 'border-border/50 opacity-75'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-surface-2 border border-border text-muted">
                      Level {lvl.id} • {lvl.difficulty}
                    </span>
                    {st.unlocked ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-teal bg-teal/10 px-2 py-0.5 rounded border border-teal/30">
                        <Unlock className="w-3 h-3" /> {st.completed ? 'Completed' : 'Unlocked'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted bg-surface-2 px-2 py-0.5 rounded border border-border">
                        <Lock className="w-3 h-3" /> Complete Level {lvl.id - 1} to unlock
                      </span>
                    )}
                  </div>

                  <div>
                    <h2 className="font-heading font-bold text-xl text-text">{lvl.name}</h2>
                    <div className="text-xs font-mono text-teal mt-0.5">{lvl.vulnClass}</div>
                    <p className="text-xs text-muted mt-2 leading-relaxed">{lvl.description}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono bg-surface-2 p-3 rounded-xl border border-border">
                    <div className="flex items-center gap-1.5 text-text">
                      <DollarSign className="w-3.5 h-3.5 text-teal" />
                      <span>${(lvl.initialVaultCents / 100).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-text">
                      <Clock className="w-3.5 h-3.5 text-muted" />
                      <span>{Math.floor(lvl.durationSeconds / 60)} min</span>
                    </div>
                    <div className="text-right text-muted">
                      {lvl.mitreTechniques.join(', ')}
                    </div>
                  </div>

                  {/* Per-level Leaderboard */}
                  <div className="pt-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-muted mb-1.5">
                      <Trophy className="w-3 h-3 text-amber-400" /> Level {lvl.id} Leaderboard
                    </div>
                    {lb.length === 0 ? (
                      <div className="text-[11px] text-muted italic">No matches completed yet.</div>
                    ) : (
                      <div className="space-y-1">
                        {lb.map((entry, idx) => (
                          <div
                            key={`${entry.username}-${entry.side}-${idx}`}
                            className="flex items-center justify-between text-[11px] font-mono bg-surface-2 px-2.5 py-1 rounded border border-border"
                          >
                            <span className="text-text">
                              #{idx + 1} @{entry.username}{' '}
                              <span className={entry.side === 'RED' ? 'text-coral' : 'text-teal'}>
                                ({entry.side})
                              </span>
                            </span>
                            <span className="text-teal font-semibold">{entry.best_score} pts</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Controls */}
                <div className="pt-4 border-t border-border space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={!st.unlocked}
                      onClick={() => setSelectedSide((p) => ({ ...p, [lvl.id]: 'RED' }))}
                      className={`py-2 px-3 rounded-xl text-xs font-heading font-semibold border flex items-center justify-center gap-1.5 transition-colors ${
                        side === 'RED'
                          ? 'bg-coral/15 border-coral text-coral'
                          : 'bg-surface-2 border-border text-muted'
                      }`}
                    >
                      <Crosshair className="w-3.5 h-3.5" /> Red (Attacker)
                    </button>
                    <button
                      type="button"
                      disabled={!st.unlocked}
                      onClick={() => setSelectedSide((p) => ({ ...p, [lvl.id]: 'BLUE' }))}
                      className={`py-2 px-3 rounded-xl text-xs font-heading font-semibold border flex items-center justify-center gap-1.5 transition-colors ${
                        side === 'BLUE'
                          ? 'bg-teal/15 border-teal text-teal'
                          : 'bg-surface-2 border-border text-muted'
                      }`}
                    >
                      <Shield className="w-3.5 h-3.5" /> Blue (Defender)
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={!st.unlocked || queuingLevel !== null}
                    onClick={() => handleJoinMatchmaking(lvl.id)}
                    className="w-full py-2.5 px-4 rounded-xl bg-teal text-bg text-xs font-heading font-semibold hover:shadow-glow-teal transition-all disabled:opacity-40"
                  >
                    {st.unlocked ? `Join Level ${lvl.id} Queue (${side})` : 'Locked'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
