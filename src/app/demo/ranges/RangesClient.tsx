
import Link from 'next/link';
import { Badge } from '@/components/common/Badge';
import type { RangeLevelConfig } from '@/lib/range-levels';
import type { UserLevelStatus, LeaderboardEntry } from '@/lib/range-progress';
import {
  Lock,
  Unlock,
  Clock,
  DollarSign,
  Trophy,
  ArrowLeft,
} from 'lucide-react';

interface RangesClientProps {
  handle: string;
  levels: RangeLevelConfig[];
  progress: UserLevelStatus[];
  leaderboards: Record<number, LeaderboardEntry[]>;
}

export function RangesClient({ handle, levels, progress, leaderboards }: RangesClientProps) {
  return (
    <div className="min-h-[90vh] bg-bg text-text py-10 px-4 sm:px-6">
      <div className="container mx-auto max-w-6xl space-y-8">
        {/* Top Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface p-6 rounded-2xl border border-border shadow-md">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href="/demo/team"
                className="text-xs text-muted hover:text-text inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Team roster
              </Link>
              <Badge type="v1" size="sm" />
            </div>
            <h1 className="font-heading font-bold text-2xl text-text tracking-tightest">
              Fintech range progress
            </h1>
            <p className="text-xs text-muted mt-0.5">
              Player: <code className="font-mono text-teal">@{handle}</code>
            </p>
          </div>
        </div>

        {/* Levels Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {levels.map((lvl) => {
            const st = progress.find((p) => p.levelId === lvl.id) || {
              levelId: lvl.id,
              unlocked: lvl.id === 1,
              completed: false,
              bestScore: 0,
            };
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


              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
