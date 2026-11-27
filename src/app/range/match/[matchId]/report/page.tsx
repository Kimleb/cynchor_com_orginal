'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MatchReport } from '@/lib/range-runtime/reports';

const usd = (c: number | null) => (c === null ? 'unknown' : (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));

export default function ReportPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = React.use(params);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/range/${encodeURIComponent(matchId)}/report`)
      .then((r) => r.json())
      .then((d) => (d.success ? setReport(d.report) : setError(d.error || 'Report unavailable.')))
      .catch(() => setError('Network error.'));
  }, [matchId]);

  if (error) return <div className="min-h-[60vh] flex items-center justify-center text-xs text-muted p-6">{error} <Link href="/range/lobby" className="ml-2 text-teal underline">Back to lobby</Link></div>;
  if (!report) return <div className="min-h-[60vh] flex items-center justify-center text-xs text-muted">Loading report...</div>;

  const win = report.winner === 'RED' ? 'RED TEAM WINS' : report.winner === 'BLUE' ? 'BLUE TEAM HOLDS THE VAULT' : 'NO WINNER';
  return (
    <div className="min-h-[80vh] bg-bg text-text py-10 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-surface border border-border rounded-2xl p-8 text-center space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">After Action Report</div>
          <h1 data-testid="winner" className={`font-heading font-bold text-3xl ${report.winner === 'RED' ? 'text-coral' : 'text-[#38BDF8]'}`}>{win}</h1>
          <p className="text-xs text-muted font-mono">{report.redTeam ?? 'Red'} vs {report.blueTeam ?? 'Blue'} · ended by {report.reason}</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 font-mono text-xs">
          <div className="bg-surface border border-border rounded-xl p-4"><div className="text-muted">Vault start</div><div className="text-lg">{usd(report.vault.startCents)}</div></div>
          <div className="bg-surface border border-border rounded-xl p-4"><div className="text-muted">Vault survived</div><div data-testid="vault-survived" className="text-lg">{usd(report.vault.survivedCents)}</div></div>
          <div className="bg-surface border border-border rounded-xl p-4"><div className="text-muted">Vault drained</div><div data-testid="vault-drained" className="text-lg text-coral">{usd(report.vault.drainedCents)}</div></div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 text-xs">
          <div className="bg-surface border border-border rounded-xl p-4 space-y-1" data-testid="score">
            <div className="text-muted uppercase tracking-wider">Final score</div>
            <div>Exploits landed: <b>{report.score.exploitsLanded}</b></div>
            <div>Exploits blocked: <b>{report.score.exploitsBlocked}</b></div>
            <div>Patches applied: <b>{report.score.patchesApplied}</b></div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 space-y-1" data-testid="mvp">
            <div className="text-muted uppercase tracking-wider">MVPs</div>
            <div><span className="text-coral">Red:</span> {report.mvp.red ? `${report.mvp.red.name} (${report.mvp.red.count} exploits)` : 'none'}</div>
            <div><span className="text-[#38BDF8]">Blue:</span> {report.mvp.blue ? `${report.mvp.blue.name} (${report.mvp.blue.count} patches)` : 'none'}</div>
          </div>
        </div>
        <div className="bg-[#0A0A0D] border border-border rounded-xl p-4 font-mono text-[11px] space-y-1" data-testid="timeline">
          <div className="text-muted uppercase tracking-wider text-xs mb-2">Timeline</div>
          {report.timeline.map((e) => (
            <div key={e.id} className="break-all">
              <span className="text-muted/70 mr-2">{new Date(e.at).toLocaleTimeString()}</span>
              <span className={`mr-2 ${e.scope === 'RED' ? 'text-coral' : e.scope === 'BLUE' ? 'text-[#38BDF8]' : 'text-teal'}`}>[{e.action.replace('RANGE_', '')}]</span>
              {e.user && <span className="mr-2">{e.user}</span>}
              <span className="text-[#A1A1AA]">{e.details}</span>
            </div>
          ))}
        </div>
        <div className="text-center"><Link href="/range/leaderboard" className="text-xs text-teal underline">Leaderboard</Link></div>
      </div>
    </div>
  );
}
