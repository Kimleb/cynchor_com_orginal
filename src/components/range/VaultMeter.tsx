'use client';
import React from 'react';
import { Landmark } from 'lucide-react';
import type { VaultState } from './useRangeEvents';

const START_CENTS = 50_000_000;
const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Central Vault counter and tension meter. Every value is derived from the latest vault event from the server.
export function VaultMeter({ vault }: { vault: VaultState }) {
  const bal = vault.balanceCents;
  const pct = bal === null ? null : Math.max(0, Math.min(100, Math.round((bal / START_CENTS) * 100)));
  const tension = pct === null ? null : 100 - pct;
  const label = tension === null ? 'AWAITING TELEMETRY' : tension >= 100 ? 'VAULT DRAINED' : tension > 66 ? 'CRITICAL' : tension > 33 ? 'ELEVATED' : tension > 0 ? 'GUARDED' : 'STABLE';
  return (
    <div className="bg-[#0A0A0D] rounded-xl border border-border p-4 font-mono">
      <div className="flex items-center gap-2 text-xs text-muted uppercase tracking-wider mb-2">
        <Landmark className="w-4 h-4 text-teal" /> Central Vault
      </div>
      <div data-testid="vault-balance" className="text-2xl font-bold text-text">{bal === null ? '--' : usd(bal)}</div>
      <div className="mt-3 text-[10px] text-muted flex justify-between"><span>TENSION</span><span data-testid="vault-tension">{label}</span></div>
      <div className="mt-1 h-2 rounded bg-[#26262C] overflow-hidden" role="progressbar" aria-valuenow={tension ?? 0} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-coral" style={{ width: `${tension ?? 0}%` }} />
      </div>
      {vault.status !== null && <div className="mt-2 text-[10px] text-muted">target: {vault.status}</div>}
    </div>
  );
}
