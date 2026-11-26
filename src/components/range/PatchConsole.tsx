'use client';
import React, { useState } from 'react';

// Blue console: edits an allowlisted target source file and sends it through the patch route.
export function PatchConsole({ matchId, initial, disabled }: { matchId: string; initial: Record<string, string>; disabled: boolean }) {
  const files = Object.keys(initial);
  const [file, setFile] = useState(files[0] ?? 'server.js');
  const [drafts, setDrafts] = useState<Record<string, string>>(initial);
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/range/${encodeURIComponent(matchId)}/patch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, content: drafts[file] ?? '' }),
      });
      const data = await res.json();
      setOut(data.success ? `Patch applied to ${file}. The target is restarting.` : `ERROR ${res.status}: ${data.error}`);
    } catch {
      setOut('Network error.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3" aria-label="Patch console">
      <div className="text-xs font-semibold uppercase tracking-wider text-[#38BDF8]">Patch console</div>
      <select value={file} onChange={(e) => setFile(e.target.value)} className="bg-bg border border-border rounded px-2 py-1.5 text-xs font-mono text-text" aria-label="File">
        {files.map((f) => <option key={f}>{f}</option>)}
      </select>
      <textarea
        value={drafts[file] ?? ''}
        onChange={(e) => setDrafts({ ...drafts, [file]: e.target.value })}
        rows={18}
        spellCheck={false}
        className="bg-[#0A0A0D] border border-border rounded px-2 py-2 text-[11px] font-mono text-text w-full"
        aria-label="File content"
      />
      <button onClick={apply} disabled={busy || disabled} className="py-2 px-4 rounded-lg bg-[#38BDF8] text-bg text-xs font-semibold disabled:opacity-50">{busy ? 'Applying...' : 'Apply patch'}</button>
      {out && <div data-testid="patch-result" className="text-xs font-mono text-muted break-all">{out}</div>}
    </div>
  );
}
