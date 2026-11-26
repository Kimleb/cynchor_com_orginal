'use client';
import React, { useState } from 'react';

// Red console: sends one request to the match's target through the proxy route and prints the raw response.
export function AttackConsole({ matchId, disabled }: { matchId: string; disabled: boolean }) {
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [path, setPath] = useState('/healthz');
  const [body, setBody] = useState('');
  const [cookie, setCookie] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      let parsed: unknown;
      if (method === 'POST' && body.trim() !== '') {
        try { parsed = JSON.parse(body); } catch { setOut('Body must be valid JSON.'); return; }
      }
      const res = await fetch(`/api/range/${encodeURIComponent(matchId)}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, path, body: parsed, cookie: cookie || undefined }),
      });
      const data = await res.json();
      if (data.success === false) setOut(`ERROR ${res.status}: ${data.error}`);
      else {
        if (data.cookie) setCookie(data.cookie);
        setOut(`HTTP ${data.status}  ${data.contentType ?? ''}\n\n${data.body}`);
      }
    } catch {
      setOut('Network error.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'bg-bg border border-border rounded px-2 py-1.5 text-xs font-mono text-text w-full';
  return (
    <form onSubmit={send} className="bg-surface border border-border rounded-xl p-4 space-y-3" aria-label="Attack console">
      <div className="text-xs font-semibold uppercase tracking-wider text-coral">Attack console</div>
      <div className="flex gap-2">
        <select value={method} onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')} className={`${field} w-24`} aria-label="Method">
          <option>GET</option>
          <option>POST</option>
        </select>
        <input value={path} onChange={(e) => setPath(e.target.value)} className={field} aria-label="Path" placeholder="/path" />
      </div>
      {method === 'POST' && <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={field} aria-label="JSON body" placeholder='{"username":"guest","password":"guest"}' />}
      <input value={cookie} onChange={(e) => setCookie(e.target.value)} className={field} aria-label="Cookie" placeholder="fc_sid=... (set automatically after login)" />
      <button disabled={busy || disabled} className="py-2 px-4 rounded-lg bg-coral text-bg text-xs font-semibold disabled:opacity-50">{busy ? 'Sending...' : 'Send request'}</button>
      <pre data-testid="attack-response" className="bg-[#0A0A0D] rounded p-3 text-[11px] font-mono text-[#A1A1AA] whitespace-pre-wrap break-all max-h-72 overflow-auto">{out || 'No response yet.'}</pre>
    </form>
  );
}
